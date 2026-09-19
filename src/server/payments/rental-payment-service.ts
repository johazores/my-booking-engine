import type { Prisma } from '../../generated/prisma/client.ts';

import { rentalBookingLockKey } from '../bookings/rental-booking-reschedule-domain.ts';
import { classifyRentalBookingWriteError } from '../bookings/rental-booking-write-errors.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { parseMoneyMajorToMinor } from '../pricing/money.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { ManualPaymentProvider, normalizeManualPaymentReference } from './manual-payment-provider.ts';
import { assertPaymentProviderCapability } from './payment-provider.ts';
import { deriveBookingRefundExecutionPlan } from './payment-refund-execution-domain.ts';
import {
  buildRentalPaymentIdempotencyKey,
  buildRentalPaymentRequestFingerprint,
  deriveRentalPaymentSettlement,
} from './rental-payment-domain.ts';
import { readRentalPaymentSettlementHistory } from './rental-payment-history.ts';

export class RentalPaymentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalPaymentConflictError';
  }
}

export class RentalPaymentUnavailableError extends Error {
  constructor(message = 'Rental payment resource is not available in this organization.') {
    super(message);
    this.name = 'RentalPaymentUnavailableError';
  }
}

const manualProvider = new ManualPaymentProvider();

function paymentLockKey(organizationId: string, scope: string, value: string) {
  return `rental-payment:${organizationId}:${scope}:${value}`;
}

function manualReferenceLockKey(organizationId: string, reference: string) {
  return `sf:rental-manual-reference:${organizationId}:${reference}`;
}

async function assertRentalManualReferenceUnused(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  reference: string,
) {
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
  if (retainedReference) {
    throw new RentalPaymentConflictError('Manual rental reference has already been recorded as commercial evidence in this organization.');
  }
}

async function runRentalPaymentWrite<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE') {
        throw new RentalPaymentConflictError('Rental payment write could not be serialized after bounded retries.');
      }
      if (disposition === 'CONFLICT') {
        throw new RentalPaymentConflictError('Rental payment write no longer satisfies the durable tenant, settlement, or lifecycle contract.');
      }
      throw error;
    }
  }
  throw new RentalPaymentConflictError('Rental payment write could not be serialized.');
}

function normalizePagination(page: number, pageSize: number) {
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 25;
  return { page: safePage, pageSize: safePageSize };
}

function parseOptionalRentalPaymentAmount(value: unknown, currency: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('Rental payment amount must be a valid money value.');
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = parseMoneyMajorToMinor(normalized, currency);
  if (parsed.amountMinor <= 0n) throw new Error('Rental payment amount must be greater than zero.');
  return parsed.amountMinor;
}

function parseOptionalRentalRefundAmount(value: unknown, currency: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('Rental refund amount must be a valid money value.');
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = parseMoneyMajorToMinor(normalized, currency);
  if (parsed.amountMinor <= 0n) throw new Error('Rental refund amount must be greater than zero.');
  return parsed.amountMinor;
}

async function readRequiredRentalPaymentHistory(
  input: Parameters<typeof readRentalPaymentSettlementHistory>[0],
) {
  const history = await readRentalPaymentSettlementHistory(input);
  if (!history.complete) throw new RentalPaymentConflictError(history.reason);
  return history.transactions;
}

async function readOriginalRentalPaymentLedgerAuthorityInTransaction(
  transaction: Prisma.TransactionClient,
  input: Readonly<{ organizationId: string; bookingId: string }>,
) {
  const amendments = await transaction.rentalBookingCommercialAmendment.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      status: { in: ['PREPARED', 'APPLIED'] },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 2,
    select: { id: true, status: true },
  });

  if (amendments.length > 1) {
    return Object.freeze({
      writable: false as const,
      amendment: null,
      reason: 'Conflicting active rental commercial amendments prevent original booking-price settlement writes.',
    });
  }

  const amendment = amendments[0];
  if (!amendment) {
    return Object.freeze({ writable: true as const, amendment: null, reason: null });
  }

  const status = amendment.status === 'PREPARED' ? 'PREPARED' as const : 'APPLIED' as const;
  return Object.freeze({
    writable: false as const,
    amendment: Object.freeze({ id: amendment.id, status }),
    reason: status === 'PREPARED'
      ? 'Original booking-price settlement is frozen while a rental commercial amendment is prepared. Finish, compensate, or close that workflow first.'
      : 'Original booking-price settlement is historical after a rental commercial amendment is applied. Use the effective settlement workflow for later refunds.',
  });
}

async function assertOriginalRentalPaymentLedgerWritable(
  transaction: Prisma.TransactionClient,
  input: Readonly<{ organizationId: string; bookingId: string }>,
) {
  const authority = await readOriginalRentalPaymentLedgerAuthorityInTransaction(transaction, input);
  if (!authority.writable) throw new RentalPaymentConflictError(authority.reason);
}

export async function readRentalOriginalPaymentLedgerAuthority(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:read' });

  return db.$transaction(async (transaction) => {
    const booking = await transaction.rentalBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!booking) throw new RentalPaymentUnavailableError('Rental booking is not available in this organization.');
    return readOriginalRentalPaymentLedgerAuthorityInTransaction(transaction, {
      organizationId: input.organizationId,
      bookingId: booking.id,
    });
  }, { isolationLevel: 'RepeatableRead' });
}

export async function recordRentalManualOfflinePayment(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  reference: unknown;
  amount?: unknown;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const reference = normalizeManualPaymentReference(input.reference);
  const idempotencyKey = buildRentalPaymentIdempotencyKey({ kind: 'manual-payment', bookingId: input.bookingId, reference });

  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' });
  assertPaymentProviderCapability(manualProvider, 'OFFLINE_RECORDING');

  return runRentalPaymentWrite(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;

    const booking = await transaction.rentalBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, currency: true, totalMinor: true },
    });
    if (!booking) throw new RentalPaymentUnavailableError('Rental booking is not available in this organization.');
    const requestedAmountMinor = parseOptionalRentalPaymentAmount(input.amount, booking.currency);

    const existing = await transaction.rentalPaymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (existing) {
      const expectedRequestFingerprint = buildRentalPaymentRequestFingerprint({
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey,
        kind: 'OFFLINE_PAYMENT',
        providerCode: manualProvider.code,
        providerReference: reference,
        sourceProviderReference: null,
        currency: booking.currency,
        amountMinor: existing.amountMinor,
      });
      if (
        existing.bookingId !== booking.id
        || existing.kind !== 'OFFLINE_PAYMENT'
        || existing.status !== 'SUCCEEDED'
        || existing.providerCode !== manualProvider.code
        || existing.providerReference !== reference
        || existing.sourceProviderReference !== null
        || existing.currency !== booking.currency
        || existing.amountMinor <= 0n
        || existing.amountMinor > booking.totalMinor
        || (requestedAmountMinor !== null && existing.amountMinor !== requestedAmountMinor)
        || (existing.requestFingerprint !== null && existing.requestFingerprint !== expectedRequestFingerprint)
      ) {
        throw new RentalPaymentConflictError('Rental payment idempotency key was already used for different durable settlement evidence.');
      }
      const history = await readRequiredRentalPaymentHistory({
        transaction,
        organizationId: input.organizationId,
        bookingId: booking.id,
      });
      const settlement = deriveRentalPaymentSettlement({ bookingTotalMinor: booking.totalMinor, currency: booking.currency, transactions: history });
      if (!settlement.reconciled) {
        throw new RentalPaymentConflictError('Rental payment idempotent replay no longer has complete reconciled settlement evidence.');
      }
      return Object.freeze({ transaction: existing, idempotent: true });
    }

    if (booking.status !== 'CONFIRMED') throw new RentalPaymentConflictError('Only confirmed rental bookings can receive an offline payment.');
    if (booking.totalMinor <= 0n) throw new RentalPaymentConflictError('A zero-value rental booking does not require an offline payment.');
    await assertOriginalRentalPaymentLedgerWritable(transaction, {
      organizationId: input.organizationId,
      bookingId: booking.id,
    });

    const history = await readRequiredRentalPaymentHistory({
      transaction,
      organizationId: input.organizationId,
      bookingId: booking.id,
    });
    const settlement = deriveRentalPaymentSettlement({ bookingTotalMinor: booking.totalMinor, currency: booking.currency, transactions: history });
    if (!settlement.reconciled) throw new RentalPaymentConflictError(settlement.reason);
    if (settlement.outstandingMinor <= 0n) {
      throw new RentalPaymentConflictError('Rental booking does not have an outstanding balance for another offline payment.');
    }
    const paymentAmountMinor = requestedAmountMinor ?? settlement.outstandingMinor;
    if (paymentAmountMinor > settlement.outstandingMinor) {
      throw new RentalPaymentConflictError('Rental payment amount exceeds the current outstanding booking balance.');
    }

    const expectedRequestFingerprint = buildRentalPaymentRequestFingerprint({
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      kind: 'OFFLINE_PAYMENT',
      providerCode: manualProvider.code,
      providerReference: reference,
      sourceProviderReference: null,
      currency: booking.currency,
      amountMinor: paymentAmountMinor,
    });

    await assertRentalManualReferenceUnused(transaction, input.organizationId, reference);

    const providerResult = await manualProvider.recordOfflinePayment({
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      money: { currency: booking.currency, amountMinor: paymentAmountMinor },
      reference,
    });
    if (
      providerResult.status !== 'PAID'
      || providerResult.providerCode !== manualProvider.code
      || providerResult.providerReference !== reference
      || providerResult.money.currency !== booking.currency
      || providerResult.money.amountMinor !== paymentAmountMinor
    ) {
      throw new RentalPaymentConflictError('Manual payment provider returned a result that does not match the authoritative rental booking request.');
    }

    const requestFingerprint = buildRentalPaymentRequestFingerprint({
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      kind: 'OFFLINE_PAYMENT',
      providerCode: providerResult.providerCode,
      providerReference: providerResult.providerReference,
      sourceProviderReference: null,
      currency: providerResult.money.currency,
      amountMinor: providerResult.money.amountMinor,
    });
    if (requestFingerprint !== expectedRequestFingerprint) {
      throw new RentalPaymentConflictError('Manual payment provider result changed the durable rental payment request identity.');
    }

    const payment = await transaction.rentalPaymentTransaction.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey,
        requestFingerprint,
        kind: 'OFFLINE_PAYMENT',
        status: 'SUCCEEDED',
        providerCode: providerResult.providerCode,
        providerReference: providerResult.providerReference,
        currency: providerResult.money.currency,
        amountMinor: providerResult.money.amountMinor,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.rental.offline-recorded',
        resourceType: 'rental-payment-transaction',
        resourceId: payment.id,
        afterData: {
          bookingId: booking.id,
          providerCode: payment.providerCode,
          kind: payment.kind,
          status: payment.status,
          currency: payment.currency,
          amountMinor: payment.amountMinor.toString(),
          outstandingMinorAfter: (settlement.outstandingMinor - payment.amountMinor).toString(),
        },
      },
    });
    return Object.freeze({ transaction: payment, idempotent: false });
  }, { isolationLevel: 'Serializable' }));
}

export async function recordRentalManualOfflineRefund(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  reference: unknown;
  amount?: unknown;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const refundReference = normalizeManualPaymentReference(input.reference);
  const idempotencyKey = buildRentalPaymentIdempotencyKey({ kind: 'manual-refund', bookingId: input.bookingId, reference: refundReference });

  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' });
  assertPaymentProviderCapability(manualProvider, 'OFFLINE_REFUND_RECORDING');

  return runRentalPaymentWrite(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;

    const booking = await transaction.rentalBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, currency: true, totalMinor: true },
    });
    if (!booking) throw new RentalPaymentUnavailableError('Rental booking is not available in this organization.');
    const requestedAmountMinor = parseOptionalRentalRefundAmount(input.amount, booking.currency);

    const existing = await transaction.rentalPaymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (existing) {
      const expectedRequestFingerprint = buildRentalPaymentRequestFingerprint({
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey,
        kind: 'REFUND',
        providerCode: manualProvider.code,
        providerReference: refundReference,
        sourceProviderReference: existing.sourceProviderReference,
        currency: booking.currency,
        amountMinor: existing.amountMinor,
      });
      if (
        existing.bookingId !== booking.id
        || existing.kind !== 'REFUND'
        || existing.status !== 'SUCCEEDED'
        || existing.providerCode !== manualProvider.code
        || existing.providerReference !== refundReference
        || existing.sourceProviderReference === null
        || existing.currency !== booking.currency
        || existing.amountMinor <= 0n
        || existing.amountMinor > booking.totalMinor
        || (requestedAmountMinor !== null && existing.amountMinor !== requestedAmountMinor)
        || (existing.requestFingerprint !== null && existing.requestFingerprint !== expectedRequestFingerprint)
      ) {
        throw new RentalPaymentConflictError('Rental refund idempotency key was already used for different durable settlement evidence.');
      }
      const history = await readRequiredRentalPaymentHistory({
        transaction,
        organizationId: input.organizationId,
        bookingId: booking.id,
      });
      const sourceExists = history.some((candidate) => (
        candidate.kind === 'OFFLINE_PAYMENT'
        && candidate.status === 'SUCCEEDED'
        && candidate.providerCode === manualProvider.code
        && candidate.providerReference === existing.sourceProviderReference
        && candidate.currency === booking.currency
      ));
      const settlement = deriveRentalPaymentSettlement({ bookingTotalMinor: booking.totalMinor, currency: booking.currency, transactions: history });
      if (!sourceExists || !settlement.reconciled) {
        throw new RentalPaymentConflictError('Rental refund idempotent replay no longer has complete reconciled source evidence.');
      }
      return Object.freeze({ transaction: existing, idempotent: true });
    }

    if (booking.status !== 'CONFIRMED') throw new RentalPaymentConflictError('Refund rental payments before cancelling the rental booking.');
    await assertOriginalRentalPaymentLedgerWritable(transaction, {
      organizationId: input.organizationId,
      bookingId: booking.id,
    });

    const history = await readRequiredRentalPaymentHistory({
      transaction,
      organizationId: input.organizationId,
      bookingId: booking.id,
    });
    const settlement = deriveRentalPaymentSettlement({ bookingTotalMinor: booking.totalMinor, currency: booking.currency, transactions: history });
    if (!settlement.reconciled) throw new RentalPaymentConflictError(settlement.reason);
    if (settlement.netSettledMinor <= 0n) {
      throw new RentalPaymentConflictError(`Rental booking payment state ${settlement.paymentState.toLowerCase()} does not accept a refund.`);
    }

    const refundPlannerPaymentState = settlement.paymentState === 'PARTIALLY_PAID'
      ? 'PARTIALLY_REFUNDED'
      : settlement.paymentState;
    if (refundPlannerPaymentState !== 'PAID' && refundPlannerPaymentState !== 'PARTIALLY_REFUNDED') {
      throw new RentalPaymentConflictError(`Rental booking payment state ${settlement.paymentState.toLowerCase()} does not accept a refund.`);
    }

    const plan = deriveBookingRefundExecutionPlan({
      bookingPaymentStatus: refundPlannerPaymentState,
      bookingTotalMinor: booking.totalMinor,
      currency: booking.currency,
      transactions: history,
      expectedProviderCode: 'manual',
      requestedAmountMinor,
    });
    if (!plan.planned) throw new RentalPaymentConflictError(plan.reason);
    if (plan.sourceKind !== 'OFFLINE_PAYMENT') throw new RentalPaymentConflictError('Rental manual refund did not resolve to a successful offline payment source.');

    const expectedRequestFingerprint = buildRentalPaymentRequestFingerprint({
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      kind: 'REFUND',
      providerCode: manualProvider.code,
      providerReference: refundReference,
      sourceProviderReference: plan.sourceProviderReference,
      currency: booking.currency,
      amountMinor: plan.amountMinor,
    });

    await assertRentalManualReferenceUnused(transaction, input.organizationId, refundReference);
    if (!manualProvider.recordOfflineRefund) throw new RentalPaymentConflictError('Manual payment provider cannot record refunds.');

    const providerResult = await manualProvider.recordOfflineRefund({
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      money: { currency: booking.currency, amountMinor: plan.amountMinor },
      paymentReference: plan.sourceProviderReference,
      refundReference,
    });
    if (
      providerResult.status !== 'REFUNDED'
      || providerResult.providerCode !== manualProvider.code
      || providerResult.providerReference !== plan.sourceProviderReference
      || providerResult.refundReference !== refundReference
      || providerResult.money.currency !== booking.currency
      || providerResult.money.amountMinor !== plan.amountMinor
    ) {
      throw new RentalPaymentConflictError('Manual payment provider returned a refund result that does not match the authoritative rental refund plan.');
    }

    const requestFingerprint = buildRentalPaymentRequestFingerprint({
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      kind: 'REFUND',
      providerCode: providerResult.providerCode,
      providerReference: providerResult.refundReference,
      sourceProviderReference: providerResult.providerReference,
      currency: providerResult.money.currency,
      amountMinor: providerResult.money.amountMinor,
    });
    if (requestFingerprint !== expectedRequestFingerprint) {
      throw new RentalPaymentConflictError('Manual refund provider result changed the durable rental refund request identity.');
    }

    const refund = await transaction.rentalPaymentTransaction.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey,
        requestFingerprint,
        kind: 'REFUND',
        status: 'SUCCEEDED',
        providerCode: providerResult.providerCode,
        providerReference: providerResult.refundReference,
        sourceProviderReference: providerResult.providerReference,
        currency: providerResult.money.currency,
        amountMinor: providerResult.money.amountMinor,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.rental.offline-refund-recorded',
        resourceType: 'rental-payment-transaction',
        resourceId: refund.id,
        afterData: { bookingId: booking.id, providerCode: refund.providerCode, kind: refund.kind, status: refund.status, currency: refund.currency, amountMinor: refund.amountMinor.toString(), nextPaymentState: plan.nextPaymentStatus },
      },
    });
    return Object.freeze({ transaction: refund, idempotent: false });
  }, { isolationLevel: 'Serializable' }));
}

export async function listRentalBookingPaymentTransactions(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  page?: number;
  pageSize?: number;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:read' });

  return db.$transaction(async (transaction) => {
    const booking = await transaction.rentalBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, currency: true, totalMinor: true },
    });
    if (!booking) throw new RentalPaymentUnavailableError('Rental booking is not available in this organization.');

    const pagination = normalizePagination(input.page ?? 1, input.pageSize ?? 25);
    const where = { organizationId: input.organizationId, bookingId: input.bookingId };
    const history = await readRentalPaymentSettlementHistory({
      transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    });
    const total = await transaction.rentalPaymentTransaction.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
    const page = Math.min(pagination.page, totalPages);
    const transactions = await transaction.rentalPaymentTransaction.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    });
    const settlement = history.complete
      ? deriveRentalPaymentSettlement({ bookingTotalMinor: booking.totalMinor, currency: booking.currency, transactions: history.transactions })
      : Object.freeze({ reconciled: false as const, reason: history.reason });
    return Object.freeze({ booking, transactions, settlement, total, page, pageSize: pagination.pageSize, totalPages });
  }, { isolationLevel: 'RepeatableRead' });
}
