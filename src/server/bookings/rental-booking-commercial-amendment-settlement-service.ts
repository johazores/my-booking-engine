import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import { findRentalUnitOperationalReadinessBlocker } from '../inventory/rental-unit-operational-readiness.ts';
import { ManualPaymentProvider, normalizeManualPaymentReference } from '../payments/manual-payment-provider.ts';
import { deriveBookingSettlementSummary } from '../payments/payment-settlement-domain.ts';
import { assertPaymentProviderCapability } from '../payments/payment-provider.ts';
import { deriveRentalPaymentSettlement } from '../payments/rental-payment-domain.ts';
import { readRentalPaymentSettlementHistory } from '../payments/rental-payment-history.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { classifyRentalBookingWriteError } from './rental-booking-write-errors.ts';
import { rentalBookingLockKey } from './rental-booking-reschedule-domain.ts';
import {
  buildRentalBookingCommercialAmendmentSettlementIdempotencyKey,
  buildRentalBookingCommercialAmendmentSettlementRequestFingerprint,
  deriveRentalBookingCommercialAmendmentRefundSource,
  deriveRentalBookingCommercialAmendmentSettlementState,
  type RentalBookingCommercialAmendmentRefundSource,
  type RentalBookingCommercialAmendmentSettlementKind,
  type RentalBookingCommercialAmendmentSettlementPurpose,
  type RentalBookingCommercialAmendmentSettlementRow,
} from './rental-booking-commercial-amendment-settlement-domain.ts';
import {
  RentalBookingCommercialAmendmentConflictError,
  RentalBookingCommercialAmendmentUnavailableError,
} from './rental-booking-commercial-amendment-service.ts';

const manualProvider = new ManualPaymentProvider();
const settlementLockKey = (org: string, id: string) => `rental-commercial-amendment-settlement:${org}:${id}`;
const manualReferenceLockKey = (org: string, ref: string) => `sf:rental-manual-reference:${org}:${ref}`;

async function runWrite<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await operation(); } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE' || disposition === 'CONFLICT') {
        throw new RentalBookingCommercialAmendmentConflictError('Rental commercial amendment settlement no longer satisfies the durable commercial contract.');
      }
      throw error;
    }
  }
  throw new RentalBookingCommercialAmendmentConflictError('Rental commercial amendment settlement could not be serialized.');
}

async function requirePermissions(input: Readonly<{ organizationId: string; actorUserId: string }>, write: boolean) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: write ? 'booking:manage' : 'booking:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: write ? 'payment:manage' : 'payment:read' }),
  ]);
}

async function loadAmendment(transaction: Prisma.TransactionClient, input: Readonly<{ organizationId: string; bookingId: string; amendmentId: string }>) {
  const amendment = await transaction.rentalBookingCommercialAmendment.findFirst({ where: {
    id: input.amendmentId, organizationId: input.organizationId, bookingId: input.bookingId,
  } });
  if (!amendment) throw new RentalBookingCommercialAmendmentUnavailableError();
  return amendment;
}

function fingerprint(input: Readonly<{
  organizationId: string; bookingId: string; amendmentId: string; idempotencyKey: string;
  purpose: RentalBookingCommercialAmendmentSettlementPurpose; kind: RentalBookingCommercialAmendmentSettlementKind;
  providerReference: string; sourceProviderReference: string | null; currency: string; amountMinor: bigint;
}>) {
  return buildRentalBookingCommercialAmendmentSettlementRequestFingerprint({ ...input, providerCode: manualProvider.code });
}

async function readRows(transaction: Prisma.TransactionClient, input: Readonly<{ organizationId: string; bookingId: string; amendmentId: string }>) {
  const rows = await transaction.rentalBookingCommercialAmendmentSettlementTransaction.findMany({
    where: { organizationId: input.organizationId, bookingId: input.bookingId, amendmentId: input.amendmentId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 3,
  });
  if (rows.length > 2) throw new RentalBookingCommercialAmendmentConflictError('Commercial amendment settlement history exceeds the supported adjustment and compensation contract.');
  for (const row of rows) {
    const expected = fingerprint({
      organizationId: input.organizationId, bookingId: input.bookingId, amendmentId: input.amendmentId,
      idempotencyKey: row.idempotencyKey, purpose: row.purpose as RentalBookingCommercialAmendmentSettlementPurpose,
      kind: row.kind as RentalBookingCommercialAmendmentSettlementKind, providerReference: row.providerReference,
      sourceProviderReference: row.sourceProviderReference, currency: row.currency, amountMinor: row.amountMinor,
    });
    if (row.requestFingerprint !== expected) throw new RentalBookingCommercialAmendmentConflictError('Commercial amendment settlement history contains invalid retained request evidence.');
  }
  return rows;
}

function state(amendment: Readonly<{ direction: string; currency: string; deltaMinor: bigint }>, rows: Awaited<ReturnType<typeof readRows>>) {
  const result = deriveRentalBookingCommercialAmendmentSettlementState({
    direction: amendment.direction as 'ADDITIONAL_CHARGE' | 'REFUND', currency: amendment.currency, deltaMinor: amendment.deltaMinor,
    rows: rows as readonly RentalBookingCommercialAmendmentSettlementRow[],
  });
  if (result.state === 'CONFLICT') throw new RentalBookingCommercialAmendmentConflictError(result.reason);
  return result;
}

async function lock(transaction: Prisma.TransactionClient, organizationId: string, bookingId: string, amendmentId: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalBookingLockKey(organizationId, bookingId)}, 0))`;
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${settlementLockKey(organizationId, amendmentId)}, 0))`;
}

async function assertManualReferenceUnused(transaction: Prisma.TransactionClient, organizationId: string, reference: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${manualReferenceLockKey(organizationId, reference)}, 0))`;
  const retainedReference = await transaction.rentalManualProviderReference.findUnique({
    where: {
      organizationId_providerReference: {
        organizationId,
        providerReference: reference,
      },
    },
    select: { sourceLedger: true, sourceId: true },
  });
  if (retainedReference) throw new RentalBookingCommercialAmendmentConflictError('Manual rental payment reference has already been retained in this organization.');
}

async function readAdjustmentRefundSource(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    organizationId: string;
    bookingId: string;
    amendmentId: string;
    currency: string;
    beforeTotalMinor: bigint;
    deltaMinor: bigint;
  }>,
): Promise<RentalBookingCommercialAmendmentRefundSource> {
  const history = await readRentalPaymentSettlementHistory({
    transaction,
    organizationId: input.organizationId,
    bookingId: input.bookingId,
  });
  if (!history.complete) return Object.freeze({ available: false as const, reason: history.reason });

  const rentalSettlement = deriveRentalPaymentSettlement({
    bookingTotalMinor: input.beforeTotalMinor,
    currency: input.currency,
    transactions: history.transactions,
  });
  if (!rentalSettlement.reconciled) {
    return Object.freeze({ available: false as const, reason: rentalSettlement.reason });
  }
  if (rentalSettlement.netSettledMinor !== input.beforeTotalMinor) {
    return Object.freeze({
      available: false as const,
      reason: 'Original rental booking-price settlement must remain fully paid before recording an amendment refund.',
    });
  }

  const bookingSummary = deriveBookingSettlementSummary({
    currency: input.currency,
    transactions: history.transactions,
  });
  if (!bookingSummary.reconciled) {
    return Object.freeze({ available: false as const, reason: bookingSummary.reason });
  }

  const priorAmendmentRefunds = await transaction.rentalBookingCommercialAmendmentSettlementTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      amendmentId: { not: input.amendmentId },
      purpose: 'ADJUSTMENT',
      kind: 'REFUND',
      status: 'SUCCEEDED',
      providerCode: 'manual',
      currency: input.currency,
    },
    select: {
      providerCode: true,
      sourceProviderReference: true,
      currency: true,
      amountMinor: true,
    },
  });

  return deriveRentalBookingCommercialAmendmentRefundSource({
    currency: input.currency,
    deltaMinor: input.deltaMinor,
    bookingSources: bookingSummary.sources,
    priorAmendmentRefunds,
  });
}

async function audit(transaction: Prisma.TransactionClient, input: Readonly<{
  organizationId: string; actorUserId: string; bookingId: string; amendmentId: string; direction: string;
  action: string; row: Readonly<{ id: string; kind: string; currency: string; amountMinor: bigint; providerCode: string }>;
}>) {
  await transaction.auditEvent.create({ data: {
    organizationId: input.organizationId, actorUserId: input.actorUserId, action: input.action,
    resourceType: 'rental-booking-commercial-amendment-settlement-transaction', resourceId: input.row.id,
    afterData: { bookingId: input.bookingId, amendmentId: input.amendmentId, direction: input.direction, kind: input.row.kind,
      currency: input.row.currency, amountMinor: input.row.amountMinor.toString(), providerCode: input.row.providerCode },
  } });
}

export async function readRentalBookingCommercialAmendmentSettlement(input: Readonly<{
  organizationId: string; actorUserId: string; bookingId: string; amendmentId: string;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId'); assertUuidIdentifier(input.amendmentId, 'amendmentId');
  await requirePermissions(input, false);
  return db.$transaction(async (transaction) => {
    const [clock] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
    if (!clock?.now) throw new RentalBookingCommercialAmendmentConflictError('Database clock is unavailable for commercial amendment readiness.');
    const amendment = await loadAmendment(transaction, input);
    const transactions = await readRows(transaction, input);
    const settlement = state(amendment, transactions);
    const preparationLive = amendment.status === 'PREPARED' && amendment.expiresAt > clock.now;
    const adjustmentRefundSource = amendment.status === 'PREPARED'
      && settlement.state === 'UNSETTLED'
      && amendment.direction === 'REFUND'
      ? await readAdjustmentRefundSource(transaction, {
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          amendmentId: input.amendmentId,
          currency: amendment.currency,
          beforeTotalMinor: amendment.beforeTotalMinor,
          deltaMinor: amendment.deltaMinor,
        })
      : null;
    return Object.freeze({
      amendment,
      transactions,
      settlement,
      databaseNow: clock.now,
      preparationLive,
      adjustmentRefundSource,
    });
  }, { isolationLevel: 'RepeatableRead' });
}

export async function recordRentalBookingCommercialAmendmentManualSettlement(input: Readonly<{
  organizationId: string; actorUserId: string; bookingId: string; amendmentId: string; reference: unknown;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId'); assertUuidIdentifier(input.amendmentId, 'amendmentId');
  const reference = normalizeManualPaymentReference(input.reference); await requirePermissions(input, true);
  return runWrite(() => db.$transaction(async (transaction) => {
    await lock(transaction, input.organizationId, input.bookingId, input.amendmentId);
    const [clock] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
    const amendment = await loadAmendment(transaction, input);
    if (!clock?.now || amendment.status !== 'PREPARED' || amendment.expiresAt <= clock.now) throw new RentalBookingCommercialAmendmentConflictError('Prepared commercial amendment authority is no longer live for adjustment settlement.');
    const rows = await readRows(transaction, input); const before = state(amendment, rows);
    if (before.state !== 'UNSETTLED') {
      const existing = rows.find((row) => row.purpose === 'ADJUSTMENT' && row.providerReference === reference);
      if (existing) return Object.freeze({ transaction: existing, settlement: before, idempotent: true as const });
      throw new RentalBookingCommercialAmendmentConflictError('Commercial amendment already has retained adjustment settlement evidence.');
    }

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, amendment.unitId)}, 0)
      )
    `;
    const [lockedClock] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
    if (!lockedClock?.now || amendment.expiresAt <= lockedClock.now) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Prepared commercial amendment authority expired before adjustment settlement could acquire inventory authority.',
      );
    }
    const operationalReadinessBlocker = await findRentalUnitOperationalReadinessBlocker(transaction, {
      organizationId: input.organizationId,
      unitId: amendment.unitId,
    });
    if (operationalReadinessBlocker) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental adjustment settlement cannot be recorded while the retained physical unit is not operationally ready.',
      );
    }

    const purpose = 'ADJUSTMENT' as const;
    const idempotencyKey = buildRentalBookingCommercialAmendmentSettlementIdempotencyKey({ amendmentId: amendment.id, purpose, reference });
    let kind: RentalBookingCommercialAmendmentSettlementKind = 'OFFLINE_PAYMENT'; let sourceProviderReference: string | null = null;
    if (amendment.direction === 'REFUND') {
      kind = 'REFUND';
      const source = await readAdjustmentRefundSource(transaction, {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        amendmentId: amendment.id,
        currency: amendment.currency,
        beforeTotalMinor: amendment.beforeTotalMinor,
        deltaMinor: amendment.deltaMinor,
      });
      if (!source.available) throw new RentalBookingCommercialAmendmentConflictError(source.reason);
      sourceProviderReference = source.providerReference;
      assertPaymentProviderCapability(manualProvider, 'OFFLINE_REFUND_RECORDING');
    } else assertPaymentProviderCapability(manualProvider, 'OFFLINE_RECORDING');
    await assertManualReferenceUnused(transaction, input.organizationId, reference);
    const requestFingerprint = fingerprint({ organizationId: input.organizationId, bookingId: input.bookingId, amendmentId: amendment.id,
      idempotencyKey, purpose, kind, providerReference: reference, sourceProviderReference, currency: amendment.currency, amountMinor: amendment.deltaMinor });
    if (kind === 'OFFLINE_PAYMENT') {
      const result = await manualProvider.recordOfflinePayment({ organizationId: input.organizationId, bookingId: input.bookingId, idempotencyKey,
        money: { currency: amendment.currency, amountMinor: amendment.deltaMinor }, reference });
      if (result.status !== 'PAID' || result.providerCode !== 'manual' || result.providerReference !== reference || result.money.amountMinor !== amendment.deltaMinor || result.money.currency !== amendment.currency) throw new RentalBookingCommercialAmendmentConflictError('Manual provider result does not match authoritative amendment charge evidence.');
    } else {
      const result = await manualProvider.recordOfflineRefund({ organizationId: input.organizationId, bookingId: input.bookingId, idempotencyKey,
        money: { currency: amendment.currency, amountMinor: amendment.deltaMinor }, paymentReference: sourceProviderReference!, refundReference: reference });
      if (result.status !== 'REFUNDED' || result.providerCode !== 'manual' || result.providerReference !== sourceProviderReference || result.refundReference !== reference || result.money.amountMinor !== amendment.deltaMinor || result.money.currency !== amendment.currency) throw new RentalBookingCommercialAmendmentConflictError('Manual provider result does not match authoritative amendment refund evidence.');
    }
    const created = await transaction.rentalBookingCommercialAmendmentSettlementTransaction.create({ data: {
      organizationId: input.organizationId, bookingId: input.bookingId, amendmentId: amendment.id, idempotencyKey, requestFingerprint, purpose, kind,
      status: 'SUCCEEDED', providerCode: 'manual', providerReference: reference, sourceProviderReference, currency: amendment.currency, amountMinor: amendment.deltaMinor,
    } });
    await audit(transaction, { organizationId: input.organizationId, actorUserId: input.actorUserId, bookingId: input.bookingId, amendmentId: amendment.id,
      direction: amendment.direction, action: 'payment.rental.commercial-amendment-adjustment-recorded', row: created });
    return Object.freeze({ transaction: created, settlement: state(amendment, [...rows, created]), idempotent: false as const });
  }, { isolationLevel: 'Serializable' }));
}

export async function recordRentalBookingCommercialAmendmentManualCompensation(input: Readonly<{
  organizationId: string; actorUserId: string; bookingId: string; amendmentId: string; reference: unknown;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId'); assertUuidIdentifier(input.amendmentId, 'amendmentId');
  const reference = normalizeManualPaymentReference(input.reference); await requirePermissions(input, true);
  return runWrite(() => db.$transaction(async (transaction) => {
    await lock(transaction, input.organizationId, input.bookingId, input.amendmentId);
    const amendment = await loadAmendment(transaction, input);
    if (amendment.status !== 'PREPARED') throw new RentalBookingCommercialAmendmentConflictError('Only a prepared commercial amendment can receive compensation.');
    const rows = await readRows(transaction, input); const before = state(amendment, rows);
    if (before.state === 'COMPENSATED') {
      const existing = rows.find((row) => row.purpose === 'COMPENSATION' && row.providerReference === reference);
      if (existing) return Object.freeze({ transaction: existing, settlement: before, idempotent: true as const });
      throw new RentalBookingCommercialAmendmentConflictError('Commercial amendment adjustment is already compensated.');
    }
    if (before.state !== 'SETTLED') throw new RentalBookingCommercialAmendmentConflictError('Compensation requires retained uncompensated adjustment money.');
    const purpose = 'COMPENSATION' as const;
    const idempotencyKey = buildRentalBookingCommercialAmendmentSettlementIdempotencyKey({ amendmentId: amendment.id, purpose, reference });
    const kind: RentalBookingCommercialAmendmentSettlementKind = amendment.direction === 'ADDITIONAL_CHARGE' ? 'REFUND' : 'OFFLINE_PAYMENT';
    const sourceProviderReference = kind === 'REFUND' ? before.adjustment.providerReference : null;
    await assertManualReferenceUnused(transaction, input.organizationId, reference);
    const requestFingerprint = fingerprint({ organizationId: input.organizationId, bookingId: input.bookingId, amendmentId: amendment.id, idempotencyKey,
      purpose, kind, providerReference: reference, sourceProviderReference, currency: amendment.currency, amountMinor: amendment.deltaMinor });
    if (kind === 'REFUND') {
      assertPaymentProviderCapability(manualProvider, 'OFFLINE_REFUND_RECORDING');
      const result = await manualProvider.recordOfflineRefund({ organizationId: input.organizationId, bookingId: input.bookingId, idempotencyKey,
        money: { currency: amendment.currency, amountMinor: amendment.deltaMinor }, paymentReference: before.adjustment.providerReference, refundReference: reference });
      if (result.status !== 'REFUNDED' || result.providerReference !== before.adjustment.providerReference || result.refundReference !== reference || result.money.amountMinor !== amendment.deltaMinor || result.money.currency !== amendment.currency) throw new RentalBookingCommercialAmendmentConflictError('Manual provider result does not match amendment compensation refund evidence.');
    } else {
      assertPaymentProviderCapability(manualProvider, 'OFFLINE_RECORDING');
      const result = await manualProvider.recordOfflinePayment({ organizationId: input.organizationId, bookingId: input.bookingId, idempotencyKey,
        money: { currency: amendment.currency, amountMinor: amendment.deltaMinor }, reference });
      if (result.status !== 'PAID' || result.providerReference !== reference || result.money.amountMinor !== amendment.deltaMinor || result.money.currency !== amendment.currency) throw new RentalBookingCommercialAmendmentConflictError('Manual provider result does not match amendment compensation payment evidence.');
    }
    const created = await transaction.rentalBookingCommercialAmendmentSettlementTransaction.create({ data: {
      organizationId: input.organizationId, bookingId: input.bookingId, amendmentId: amendment.id, idempotencyKey, requestFingerprint, purpose, kind,
      status: 'SUCCEEDED', providerCode: 'manual', providerReference: reference, sourceProviderReference, currency: amendment.currency, amountMinor: amendment.deltaMinor,
    } });
    await audit(transaction, { organizationId: input.organizationId, actorUserId: input.actorUserId, bookingId: input.bookingId, amendmentId: amendment.id,
      direction: amendment.direction, action: 'payment.rental.commercial-amendment-compensated', row: created });
    return Object.freeze({ transaction: created, settlement: state(amendment, [...rows, created]), idempotent: false as const });
  }, { isolationLevel: 'Serializable' }));
}
