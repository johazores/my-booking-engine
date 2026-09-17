import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { classifyRentalBookingWriteError } from '../bookings/rental-booking-write-errors.ts';
import { rentalBookingLockKey } from '../bookings/rental-booking-reschedule-domain.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { ManualPaymentProvider, normalizeManualPaymentReference } from './manual-payment-provider.ts';
import { assertPaymentProviderCapability } from './payment-provider.ts';
import {
  buildRentalLateReturnSettlementIdempotencyKey,
  buildRentalLateReturnSettlementRequestFingerprint,
  deriveRentalLateReturnSettlement,
} from './rental-late-return-settlement-domain.ts';

export class RentalLateReturnSettlementConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalLateReturnSettlementConflictError';
  }
}

export class RentalLateReturnSettlementUnavailableError extends Error {
  constructor(message = 'Rental late-return settlement resource is not available in this organization.') {
    super(message);
    this.name = 'RentalLateReturnSettlementUnavailableError';
  }
}

const manualProvider = new ManualPaymentProvider();

function settlementLockKey(organizationId: string, scope: string, value: string) {
  return `rental-late-return-settlement:${organizationId}:${scope}:${value}`;
}

function manualReferenceLockKey(organizationId: string, reference: string) {
  return `sf:rental-manual-reference:${organizationId}:${reference}`;
}

async function runRentalLateReturnSettlementWrite<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE') {
        throw new RentalLateReturnSettlementConflictError('Late-return settlement write could not be serialized after bounded retries.');
      }
      if (disposition === 'CONFLICT') {
        throw new RentalLateReturnSettlementConflictError('Late-return settlement write no longer satisfies the durable tenant or settlement contract.');
      }
      throw error;
    }
  }
  throw new RentalLateReturnSettlementConflictError('Late-return settlement write could not be serialized.');
}

async function requireReadPermissions(input: Readonly<{ organizationId: string; actorUserId: string }>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:read' }),
  ]);
}

async function requireWritePermissions(input: Readonly<{ organizationId: string; actorUserId: string }>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);
}

function expectedFingerprint(input: Readonly<{
  organizationId: string;
  bookingId: string;
  assessmentId: string;
  idempotencyKey: string;
  kind: 'OFFLINE_PAYMENT' | 'REFUND';
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
}>) {
  return buildRentalLateReturnSettlementRequestFingerprint({ ...input, providerCode: manualProvider.code });
}

async function loadAssessment(transaction: Prisma.TransactionClient, input: Readonly<{
  organizationId: string;
  bookingId: string;
  assessmentId: string;
}>) {
  const assessment = await transaction.rentalLateReturnAssessment.findFirst({
    where: {
      id: input.assessmentId,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      outcome: 'FEE_ASSESSED',
    },
    select: { id: true, bookingId: true, unitId: true, currency: true, feeMinor: true },
  });
  if (!assessment || assessment.feeMinor === null || assessment.feeMinor <= 0n) {
    throw new RentalLateReturnSettlementUnavailableError('A retained positive late-return fee assessment is required before settlement.');
  }
  return assessment;
}

async function readRows(transaction: Prisma.TransactionClient, input: Readonly<{
  organizationId: string;
  bookingId: string;
  assessmentId: string;
}>) {
  const rows = await transaction.rentalLateReturnSettlementTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      assessmentId: input.assessmentId,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 3,
  });
  if (rows.length > 2) {
    throw new RentalLateReturnSettlementConflictError('Late-return settlement history exceeds the enabled one-payment/one-refund contract.');
  }
  for (const row of rows) {
    const fingerprint = expectedFingerprint({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      assessmentId: input.assessmentId,
      idempotencyKey: row.idempotencyKey,
      kind: row.kind as 'OFFLINE_PAYMENT' | 'REFUND',
      providerReference: row.providerReference,
      sourceProviderReference: row.sourceProviderReference,
      currency: row.currency,
      amountMinor: row.amountMinor,
    });
    if (row.requestFingerprint !== fingerprint) {
      throw new RentalLateReturnSettlementConflictError('Late-return settlement history contains invalid retained request evidence.');
    }
  }
  return rows as typeof rows & readonly {
    kind: 'OFFLINE_PAYMENT' | 'REFUND';
    status: 'SUCCEEDED';
  }[];
}

function reconcileRows(assessment: Readonly<{ currency: string; feeMinor: bigint | null }>, rows: Awaited<ReturnType<typeof readRows>>) {
  if (assessment.feeMinor === null || assessment.feeMinor <= 0n) {
    throw new RentalLateReturnSettlementConflictError('Late-return settlement requires retained positive fee authority.');
  }
  const settlement = deriveRentalLateReturnSettlement({
    feeMinor: assessment.feeMinor,
    currency: assessment.currency,
    transactions: rows,
  });
  if (!settlement.reconciled) throw new RentalLateReturnSettlementConflictError(settlement.reason);
  return settlement;
}

async function assertManualReferenceUnused(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  reference: string,
) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${manualReferenceLockKey(organizationId, reference)}, 0))`;
  const [booking, damage, bond, lateReturn] = await Promise.all([
    transaction.rentalPaymentTransaction.findFirst({ where: { organizationId, providerCode: 'manual', providerReference: reference }, select: { id: true } }),
    transaction.rentalDamageSettlementTransaction.findFirst({ where: { organizationId, providerCode: 'manual', providerReference: reference }, select: { id: true } }),
    transaction.rentalSecurityBondTransaction.findFirst({ where: { organizationId, providerCode: 'manual', providerReference: reference }, select: { id: true } }),
    transaction.rentalLateReturnSettlementTransaction.findFirst({ where: { organizationId, providerCode: 'manual', providerReference: reference }, select: { id: true } }),
  ]);
  if (booking || damage || bond || lateReturn) {
    throw new RentalLateReturnSettlementConflictError('Manual rental payment reference has already been retained in this organization.');
  }
}

export async function readRentalLateReturnSettlement(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  assessmentId: string;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.assessmentId, 'assessmentId');
  await requireReadPermissions(input);

  return db.$transaction(async (transaction) => {
    const assessment = await loadAssessment(transaction, input);
    const transactions = await readRows(transaction, {
      organizationId: input.organizationId,
      bookingId: assessment.bookingId,
      assessmentId: assessment.id,
    });
    return Object.freeze({ assessment, transactions, settlement: reconcileRows(assessment, transactions) });
  }, { isolationLevel: 'RepeatableRead' });
}

export async function recordRentalLateReturnManualOfflinePayment(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  assessmentId: string;
  reference: unknown;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.assessmentId, 'assessmentId');
  const reference = normalizeManualPaymentReference(input.reference);
  await requireWritePermissions(input);
  assertPaymentProviderCapability(manualProvider, 'OFFLINE_RECORDING');

  return runRentalLateReturnSettlementWrite(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0))`;
    const assessment = await loadAssessment(transaction, input);
    const idempotencyKey = buildRentalLateReturnSettlementIdempotencyKey({ kind: 'manual-payment', assessmentId: assessment.id, reference });
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${settlementLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;

    const fingerprint = expectedFingerprint({
      organizationId: input.organizationId,
      bookingId: assessment.bookingId,
      assessmentId: assessment.id,
      idempotencyKey,
      kind: 'OFFLINE_PAYMENT',
      providerReference: reference,
      sourceProviderReference: null,
      currency: assessment.currency,
      amountMinor: assessment.feeMinor!,
    });
    const existing = await transaction.rentalLateReturnSettlementTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (existing) {
      if (
        existing.assessmentId !== assessment.id
        || existing.bookingId !== assessment.bookingId
        || existing.kind !== 'OFFLINE_PAYMENT'
        || existing.status !== 'SUCCEEDED'
        || existing.providerCode !== manualProvider.code
        || existing.providerReference !== reference
        || existing.sourceProviderReference !== null
        || existing.currency !== assessment.currency
        || existing.amountMinor !== assessment.feeMinor
        || existing.requestFingerprint !== fingerprint
      ) throw new RentalLateReturnSettlementConflictError('Late-return payment idempotency is already bound to different retained evidence.');

      const rows = await readRows(transaction, { organizationId: input.organizationId, bookingId: assessment.bookingId, assessmentId: assessment.id });
      const settlement = reconcileRows(assessment, rows);
      if (settlement.state !== 'PAID' && settlement.state !== 'REFUNDED') {
        throw new RentalLateReturnSettlementConflictError('Late-return payment replay no longer reconciles to retained settlement evidence.');
      }
      return Object.freeze({ transaction: existing, settlement, idempotent: true as const });
    }

    const rows = await readRows(transaction, { organizationId: input.organizationId, bookingId: assessment.bookingId, assessmentId: assessment.id });
    const before = reconcileRows(assessment, rows);
    if (before.state !== 'UNPAID') throw new RentalLateReturnSettlementConflictError('Late-return fee already has retained payment evidence.');

    await assertManualReferenceUnused(transaction, input.organizationId, reference);
    const result = await manualProvider.recordOfflinePayment({
      organizationId: input.organizationId,
      bookingId: assessment.bookingId,
      idempotencyKey,
      money: { currency: assessment.currency, amountMinor: assessment.feeMinor! },
      reference,
    });
    if (
      result.status !== 'PAID'
      || result.providerCode !== manualProvider.code
      || result.providerReference !== reference
      || result.money.currency !== assessment.currency
      || result.money.amountMinor !== assessment.feeMinor
    ) throw new RentalLateReturnSettlementConflictError('Manual provider result does not match authoritative late-return fee evidence.');

    const created = await transaction.rentalLateReturnSettlementTransaction.create({
      data: {
        organizationId: input.organizationId,
        bookingId: assessment.bookingId,
        assessmentId: assessment.id,
        idempotencyKey,
        requestFingerprint: fingerprint,
        kind: 'OFFLINE_PAYMENT',
        status: 'SUCCEEDED',
        providerCode: result.providerCode,
        providerReference: result.providerReference,
        currency: result.money.currency,
        amountMinor: result.money.amountMinor,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.rental.late-return-offline-recorded',
        resourceType: 'rental-late-return-settlement-transaction',
        resourceId: created.id,
        afterData: { bookingId: assessment.bookingId, assessmentId: assessment.id, currency: created.currency, amountMinor: created.amountMinor.toString(), providerCode: created.providerCode },
      },
    });
    const afterRows = [...rows, created] as typeof rows;
    return Object.freeze({ transaction: created, settlement: reconcileRows(assessment, afterRows), idempotent: false as const });
  }, { isolationLevel: 'Serializable' }));
}

export async function recordRentalLateReturnManualOfflineRefund(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  assessmentId: string;
  reference: unknown;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.assessmentId, 'assessmentId');
  const refundReference = normalizeManualPaymentReference(input.reference);
  await requireWritePermissions(input);
  assertPaymentProviderCapability(manualProvider, 'OFFLINE_REFUND_RECORDING');

  return runRentalLateReturnSettlementWrite(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0))`;
    const assessment = await loadAssessment(transaction, input);
    const idempotencyKey = buildRentalLateReturnSettlementIdempotencyKey({ kind: 'manual-refund', assessmentId: assessment.id, reference: refundReference });
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${settlementLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;

    const rows = await readRows(transaction, { organizationId: input.organizationId, bookingId: assessment.bookingId, assessmentId: assessment.id });
    const before = reconcileRows(assessment, rows);
    const source = rows.find((row) => row.kind === 'OFFLINE_PAYMENT') ?? null;
    if (!source) throw new RentalLateReturnSettlementConflictError('A retained late-return payment is required before recording a refund.');

    const fingerprint = expectedFingerprint({
      organizationId: input.organizationId,
      bookingId: assessment.bookingId,
      assessmentId: assessment.id,
      idempotencyKey,
      kind: 'REFUND',
      providerReference: refundReference,
      sourceProviderReference: source.providerReference,
      currency: assessment.currency,
      amountMinor: assessment.feeMinor!,
    });
    const existing = await transaction.rentalLateReturnSettlementTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (existing) {
      if (
        existing.assessmentId !== assessment.id
        || existing.bookingId !== assessment.bookingId
        || existing.kind !== 'REFUND'
        || existing.status !== 'SUCCEEDED'
        || existing.providerCode !== manualProvider.code
        || existing.providerReference !== refundReference
        || existing.sourceProviderReference !== source.providerReference
        || existing.currency !== assessment.currency
        || existing.amountMinor !== assessment.feeMinor
        || existing.requestFingerprint !== fingerprint
      ) throw new RentalLateReturnSettlementConflictError('Late-return refund idempotency is already bound to different retained evidence.');
      if (before.state !== 'REFUNDED') throw new RentalLateReturnSettlementConflictError('Late-return refund replay no longer reconciles to retained settlement evidence.');
      return Object.freeze({ transaction: existing, settlement: before, idempotent: true as const });
    }

    if (before.state !== 'PAID') throw new RentalLateReturnSettlementConflictError('Only a paid late-return fee can receive the enabled full manual refund.');
    await assertManualReferenceUnused(transaction, input.organizationId, refundReference);
    if (!manualProvider.recordOfflineRefund) throw new RentalLateReturnSettlementConflictError('Manual payment provider cannot record refunds.');
    const result = await manualProvider.recordOfflineRefund({
      organizationId: input.organizationId,
      bookingId: assessment.bookingId,
      idempotencyKey,
      money: { currency: assessment.currency, amountMinor: assessment.feeMinor! },
      paymentReference: source.providerReference,
      refundReference,
    });
    if (
      result.status !== 'REFUNDED'
      || result.providerCode !== manualProvider.code
      || result.providerReference !== source.providerReference
      || result.refundReference !== refundReference
      || result.money.currency !== assessment.currency
      || result.money.amountMinor !== assessment.feeMinor
    ) throw new RentalLateReturnSettlementConflictError('Manual refund result does not match authoritative late-return settlement evidence.');

    const created = await transaction.rentalLateReturnSettlementTransaction.create({
      data: {
        organizationId: input.organizationId,
        bookingId: assessment.bookingId,
        assessmentId: assessment.id,
        idempotencyKey,
        requestFingerprint: fingerprint,
        kind: 'REFUND',
        status: 'SUCCEEDED',
        providerCode: result.providerCode,
        providerReference: result.refundReference,
        sourceProviderReference: result.providerReference,
        currency: result.money.currency,
        amountMinor: result.money.amountMinor,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.rental.late-return-offline-refund-recorded',
        resourceType: 'rental-late-return-settlement-transaction',
        resourceId: created.id,
        afterData: { bookingId: assessment.bookingId, assessmentId: assessment.id, sourceProviderReference: created.sourceProviderReference, currency: created.currency, amountMinor: created.amountMinor.toString(), providerCode: created.providerCode },
      },
    });
    const afterRows = [...rows, created] as typeof rows;
    return Object.freeze({ transaction: created, settlement: reconcileRows(assessment, afterRows), idempotent: false as const });
  }, { isolationLevel: 'Serializable' }));
}
