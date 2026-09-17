import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { classifyRentalBookingWriteError } from '../bookings/rental-booking-write-errors.ts';
import { db } from '../database.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { ManualPaymentProvider, normalizeManualPaymentReference } from './manual-payment-provider.ts';
import { assertPaymentProviderCapability } from './payment-provider.ts';
import {
  buildRentalDamageSettlementIdempotencyKey,
  buildRentalDamageSettlementRequestFingerprint,
  deriveRentalDamageSettlement,
} from './rental-damage-settlement-domain.ts';

export class RentalDamageSettlementConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalDamageSettlementConflictError';
  }
}

export class RentalDamageSettlementUnavailableError extends Error {
  constructor(message = 'Rental damage settlement resource is not available in this organization.') {
    super(message);
    this.name = 'RentalDamageSettlementUnavailableError';
  }
}

const manualProvider = new ManualPaymentProvider();

function settlementLockKey(organizationId: string, scope: string, value: string) {
  return `rental-damage-settlement:${organizationId}:${scope}:${value}`;
}

function manualReferenceLockKey(organizationId: string, reference: string) {
  return `sf:rental-manual-reference:${organizationId}:${reference}`;
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
    throw new RentalDamageSettlementConflictError('Manual rental reference has already been retained as commercial evidence in this organization.');
  }
}

async function runRentalDamageSettlementWrite<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE') {
        throw new RentalDamageSettlementConflictError('Damage settlement write could not be serialized after bounded retries.');
      }
      if (disposition === 'CONFLICT') {
        throw new RentalDamageSettlementConflictError('Damage settlement write no longer satisfies the durable tenant or settlement contract.');
      }
      throw error;
    }
  }
  throw new RentalDamageSettlementConflictError('Damage settlement write could not be serialized.');
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
  damageCaseId: string;
  liabilityDecisionId: string;
  idempotencyKey: string;
  kind: 'OFFLINE_PAYMENT' | 'REFUND';
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
}>) {
  return buildRentalDamageSettlementRequestFingerprint({
    ...input,
    providerCode: manualProvider.code,
  });
}

function reconcileRows(liability: Readonly<{ currency: string; liableAmountMinor: bigint | null }>, rows: readonly {
  kind: 'OFFLINE_PAYMENT' | 'REFUND';
  status: 'SUCCEEDED';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
}[]) {
  if (liability.liableAmountMinor === null || liability.liableAmountMinor <= 0n) {
    throw new RentalDamageSettlementConflictError('Damage settlement requires retained positive customer-liability authority.');
  }
  const settlement = deriveRentalDamageSettlement({
    liableAmountMinor: liability.liableAmountMinor,
    currency: liability.currency,
    transactions: rows,
  });
  if (!settlement.reconciled) throw new RentalDamageSettlementConflictError(settlement.reason);
  return settlement;
}

async function loadLiability(transaction: Prisma.TransactionClient, input: Readonly<{
  organizationId: string;
  bookingId: string;
  damageCaseId: string;
}>) {
  const liability = await transaction.rentalDamageLiabilityDecision.findFirst({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      damageCaseId: input.damageCaseId,
      outcome: 'CUSTOMER_LIABLE',
    },
    select: {
      id: true,
      bookingId: true,
      damageCaseId: true,
      unitId: true,
      currency: true,
      liableAmountMinor: true,
    },
  });
  if (!liability || liability.liableAmountMinor === null || liability.liableAmountMinor <= 0n) {
    throw new RentalDamageSettlementUnavailableError('A retained customer-liable damage decision is required before settlement.');
  }
  return liability;
}

async function readRows(transaction: Prisma.TransactionClient, input: Readonly<{
  organizationId: string;
  liabilityDecisionId: string;
  bookingId: string;
  damageCaseId: string;
}>) {
  const rows = await transaction.rentalDamageSettlementTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      liabilityDecisionId: input.liabilityDecisionId,
      bookingId: input.bookingId,
      damageCaseId: input.damageCaseId,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 3,
  });
  if (rows.length > 2) {
    throw new RentalDamageSettlementConflictError('Damage settlement history exceeds the enabled one-payment/one-refund contract.');
  }
  for (const row of rows) {
    const fingerprint = expectedFingerprint({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      damageCaseId: input.damageCaseId,
      liabilityDecisionId: input.liabilityDecisionId,
      idempotencyKey: row.idempotencyKey,
      kind: row.kind as 'OFFLINE_PAYMENT' | 'REFUND',
      providerReference: row.providerReference,
      sourceProviderReference: row.sourceProviderReference,
      currency: row.currency,
      amountMinor: row.amountMinor,
    });
    if (row.requestFingerprint !== fingerprint) {
      throw new RentalDamageSettlementConflictError('Damage settlement history contains invalid retained request evidence.');
    }
  }
  return rows as typeof rows & readonly {
    kind: 'OFFLINE_PAYMENT' | 'REFUND';
    status: 'SUCCEEDED';
  }[];
}

export async function readRentalDamageSettlement(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  damageCaseId: string;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.damageCaseId, 'damageCaseId');
  await requireReadPermissions(input);

  return db.$transaction(async (transaction) => {
    const liability = await loadLiability(transaction, input);
    const transactions = await readRows(transaction, {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      damageCaseId: input.damageCaseId,
      liabilityDecisionId: liability.id,
    });
    const settlement = reconcileRows(liability, transactions);
    return Object.freeze({ liability, transactions, settlement });
  }, { isolationLevel: 'RepeatableRead' });
}

export async function recordRentalDamageManualOfflinePayment(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  damageCaseId: string;
  reference: unknown;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.damageCaseId, 'damageCaseId');
  const reference = normalizeManualPaymentReference(input.reference);
  await requireWritePermissions(input);
  assertPaymentProviderCapability(manualProvider, 'OFFLINE_RECORDING');

  return runRentalDamageSettlementWrite(() => db.$transaction(async (transaction) => {
    const located = await loadLiability(transaction, input);
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalUnitLockKey(input.organizationId, located.unitId)}, 0))`;

    const liability = await loadLiability(transaction, input);
    const idempotencyKey = buildRentalDamageSettlementIdempotencyKey({
      kind: 'manual-payment',
      liabilityDecisionId: liability.id,
      reference,
    });
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${settlementLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;

    const fingerprint = expectedFingerprint({
      organizationId: input.organizationId,
      bookingId: liability.bookingId,
      damageCaseId: liability.damageCaseId,
      liabilityDecisionId: liability.id,
      idempotencyKey,
      kind: 'OFFLINE_PAYMENT',
      providerReference: reference,
      sourceProviderReference: null,
      currency: liability.currency,
      amountMinor: liability.liableAmountMinor!,
    });
    const existing = await transaction.rentalDamageSettlementTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (existing) {
      if (
        existing.liabilityDecisionId !== liability.id
        || existing.bookingId !== liability.bookingId
        || existing.damageCaseId !== liability.damageCaseId
        || existing.kind !== 'OFFLINE_PAYMENT'
        || existing.status !== 'SUCCEEDED'
        || existing.providerCode !== manualProvider.code
        || existing.providerReference !== reference
        || existing.sourceProviderReference !== null
        || existing.currency !== liability.currency
        || existing.amountMinor !== liability.liableAmountMinor
        || existing.requestFingerprint !== fingerprint
      ) throw new RentalDamageSettlementConflictError('Damage payment idempotency is already bound to different retained evidence.');

      const rows = await readRows(transaction, { organizationId: input.organizationId, bookingId: liability.bookingId, damageCaseId: liability.damageCaseId, liabilityDecisionId: liability.id });
      const settlement = reconcileRows(liability, rows);
      if (settlement.state !== 'PAID' && settlement.state !== 'REFUNDED') throw new RentalDamageSettlementConflictError('Damage payment replay no longer reconciles to retained settlement evidence.');
      return Object.freeze({ transaction: existing, settlement, idempotent: true as const });
    }

    const rows = await readRows(transaction, { organizationId: input.organizationId, bookingId: liability.bookingId, damageCaseId: liability.damageCaseId, liabilityDecisionId: liability.id });
    const before = reconcileRows(liability, rows);
    if (before.state !== 'UNPAID') throw new RentalDamageSettlementConflictError('Customer damage liability already has retained payment evidence.');

    await assertManualReferenceUnused(transaction, input.organizationId, reference);

    const result = await manualProvider.recordOfflinePayment({
      organizationId: input.organizationId,
      bookingId: liability.bookingId,
      idempotencyKey,
      money: { currency: liability.currency, amountMinor: liability.liableAmountMinor! },
      reference,
    });
    if (
      result.status !== 'PAID'
      || result.providerCode !== manualProvider.code
      || result.providerReference !== reference
      || result.money.currency !== liability.currency
      || result.money.amountMinor !== liability.liableAmountMinor
    ) throw new RentalDamageSettlementConflictError('Manual provider result does not match authoritative damage liability.');

    const created = await transaction.rentalDamageSettlementTransaction.create({
      data: {
        organizationId: input.organizationId,
        bookingId: liability.bookingId,
        damageCaseId: liability.damageCaseId,
        liabilityDecisionId: liability.id,
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
        action: 'payment.rental.damage-offline-recorded',
        resourceType: 'rental-damage-settlement-transaction',
        resourceId: created.id,
        afterData: { bookingId: liability.bookingId, damageCaseId: liability.damageCaseId, liabilityDecisionId: liability.id, currency: created.currency, amountMinor: created.amountMinor.toString(), providerCode: created.providerCode },
      },
    });
    return Object.freeze({ transaction: created, settlement: Object.freeze({ ...before, state: 'PAID' as const, collectedMinor: liability.liableAmountMinor!, netCollectedMinor: liability.liableAmountMinor!, sourceProviderReference: created.providerReference }), idempotent: false as const });
  }, { isolationLevel: 'Serializable' }));
}

export async function recordRentalDamageManualOfflineRefund(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  damageCaseId: string;
  reference: unknown;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.damageCaseId, 'damageCaseId');
  const refundReference = normalizeManualPaymentReference(input.reference);
  await requireWritePermissions(input);
  assertPaymentProviderCapability(manualProvider, 'OFFLINE_REFUND_RECORDING');

  return runRentalDamageSettlementWrite(() => db.$transaction(async (transaction) => {
    const located = await loadLiability(transaction, input);
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalUnitLockKey(input.organizationId, located.unitId)}, 0))`;
    const liability = await loadLiability(transaction, input);
    const idempotencyKey = buildRentalDamageSettlementIdempotencyKey({ kind: 'manual-refund', liabilityDecisionId: liability.id, reference: refundReference });
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${settlementLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;

    const rows = await readRows(transaction, { organizationId: input.organizationId, bookingId: liability.bookingId, damageCaseId: liability.damageCaseId, liabilityDecisionId: liability.id });
    const before = reconcileRows(liability, rows);
    const source = rows.find((row) => row.kind === 'OFFLINE_PAYMENT') ?? null;
    if (!source) throw new RentalDamageSettlementConflictError('A retained damage payment is required before recording a refund.');

    const fingerprint = expectedFingerprint({
      organizationId: input.organizationId,
      bookingId: liability.bookingId,
      damageCaseId: liability.damageCaseId,
      liabilityDecisionId: liability.id,
      idempotencyKey,
      kind: 'REFUND',
      providerReference: refundReference,
      sourceProviderReference: source.providerReference,
      currency: liability.currency,
      amountMinor: liability.liableAmountMinor!,
    });
    const existing = await transaction.rentalDamageSettlementTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (existing) {
      if (
        existing.liabilityDecisionId !== liability.id
        || existing.kind !== 'REFUND'
        || existing.status !== 'SUCCEEDED'
        || existing.providerCode !== manualProvider.code
        || existing.providerReference !== refundReference
        || existing.sourceProviderReference !== source.providerReference
        || existing.currency !== liability.currency
        || existing.amountMinor !== liability.liableAmountMinor
        || existing.requestFingerprint !== fingerprint
      ) throw new RentalDamageSettlementConflictError('Damage refund idempotency is already bound to different retained evidence.');
      if (before.state !== 'REFUNDED') throw new RentalDamageSettlementConflictError('Damage refund replay no longer reconciles to retained settlement evidence.');
      return Object.freeze({ transaction: existing, settlement: before, idempotent: true as const });
    }

    if (before.state !== 'PAID') throw new RentalDamageSettlementConflictError('Only paid customer damage liability can receive the enabled full manual refund.');
    await assertManualReferenceUnused(transaction, input.organizationId, refundReference);
    if (!manualProvider.recordOfflineRefund) throw new RentalDamageSettlementConflictError('Manual payment provider cannot record refunds.');
    const result = await manualProvider.recordOfflineRefund({
      organizationId: input.organizationId,
      bookingId: liability.bookingId,
      idempotencyKey,
      money: { currency: liability.currency, amountMinor: liability.liableAmountMinor! },
      paymentReference: source.providerReference,
      refundReference,
    });
    if (
      result.status !== 'REFUNDED'
      || result.providerCode !== manualProvider.code
      || result.providerReference !== source.providerReference
      || result.refundReference !== refundReference
      || result.money.currency !== liability.currency
      || result.money.amountMinor !== liability.liableAmountMinor
    ) throw new RentalDamageSettlementConflictError('Manual refund result does not match authoritative damage settlement evidence.');

    const created = await transaction.rentalDamageSettlementTransaction.create({
      data: {
        organizationId: input.organizationId,
        bookingId: liability.bookingId,
        damageCaseId: liability.damageCaseId,
        liabilityDecisionId: liability.id,
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
        action: 'payment.rental.damage-offline-refund-recorded',
        resourceType: 'rental-damage-settlement-transaction',
        resourceId: created.id,
        afterData: { bookingId: liability.bookingId, damageCaseId: liability.damageCaseId, liabilityDecisionId: liability.id, sourceProviderReference: created.sourceProviderReference, currency: created.currency, amountMinor: created.amountMinor.toString(), providerCode: created.providerCode },
      },
    });
    const afterRows = [...rows, created] as typeof rows;
    return Object.freeze({ transaction: created, settlement: reconcileRows(liability, afterRows), idempotent: false as const });
  }, { isolationLevel: 'Serializable' }));
}
