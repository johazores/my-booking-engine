import { rentalBookingLockKey } from '../bookings/rental-booking-reschedule-domain.ts';
import { classifyRentalBookingWriteError } from '../bookings/rental-booking-write-errors.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { ManualPaymentProvider, normalizeManualPaymentReference } from './manual-payment-provider.ts';
import { assertPaymentProviderCapability } from './payment-provider.ts';
import { deriveBookingRefundExecutionPlan } from './payment-refund-execution-domain.ts';
import { buildRentalPaymentIdempotencyKey, deriveRentalPaymentSettlement } from './rental-payment-domain.ts';

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

const paymentHistorySelect = {
  kind: true,
  status: true,
  providerCode: true,
  providerReference: true,
  sourceProviderReference: true,
  currency: true,
  amountMinor: true,
} as const;

export async function recordRentalManualOfflinePayment(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  reference: unknown;
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

    const existing = await transaction.rentalPaymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (existing) {
      if (existing.bookingId !== input.bookingId || existing.kind !== 'OFFLINE_PAYMENT' || existing.providerCode !== manualProvider.code || existing.providerReference !== reference) {
        throw new RentalPaymentConflictError('Rental payment idempotency key was already used for a different operation.');
      }
      return Object.freeze({ transaction: existing, idempotent: true });
    }

    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'manual-reference', reference)}, 0))`;
    const booking = await transaction.rentalBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, currency: true, totalMinor: true },
    });
    if (!booking) throw new RentalPaymentUnavailableError('Rental booking is not available in this organization.');
    if (booking.status !== 'CONFIRMED') throw new RentalPaymentConflictError('Only confirmed rental bookings can receive an offline payment.');
    if (booking.totalMinor <= 0n) throw new RentalPaymentConflictError('A zero-value rental booking does not require an offline payment.');

    const history = await transaction.rentalPaymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: booking.id },
      select: paymentHistorySelect,
    });
    const settlement = deriveRentalPaymentSettlement({ bookingTotalMinor: booking.totalMinor, currency: booking.currency, transactions: history });
    if (!settlement.reconciled) throw new RentalPaymentConflictError(settlement.reason);
    if (settlement.paymentState !== 'UNPAID') {
      throw new RentalPaymentConflictError(`Rental booking payment state ${settlement.paymentState.toLowerCase()} does not accept a new full offline payment.`);
    }

    const duplicateReference = await transaction.rentalPaymentTransaction.findFirst({
      where: { organizationId: input.organizationId, providerCode: manualProvider.code, providerReference: reference },
      select: { id: true },
    });
    if (duplicateReference) throw new RentalPaymentConflictError('Manual payment reference has already been recorded in this organization.');

    const providerResult = await manualProvider.recordOfflinePayment({
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      money: { currency: booking.currency, amountMinor: booking.totalMinor },
      reference,
    });
    if (providerResult.status !== 'PAID' || providerResult.money.currency !== booking.currency || providerResult.money.amountMinor !== booking.totalMinor) {
      throw new RentalPaymentConflictError('Manual payment provider returned a result that does not match the authoritative rental booking total.');
    }

    const payment = await transaction.rentalPaymentTransaction.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey,
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
        afterData: { bookingId: booking.id, providerCode: payment.providerCode, kind: payment.kind, status: payment.status, currency: payment.currency, amountMinor: payment.amountMinor.toString() },
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

    const existing = await transaction.rentalPaymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (existing) {
      if (existing.bookingId !== input.bookingId || existing.kind !== 'REFUND' || existing.providerCode !== manualProvider.code || existing.providerReference !== refundReference) {
        throw new RentalPaymentConflictError('Rental refund idempotency key was already used for a different operation.');
      }
      return Object.freeze({ transaction: existing, idempotent: true });
    }

    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'manual-reference', refundReference)}, 0))`;
    const booking = await transaction.rentalBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, currency: true, totalMinor: true },
    });
    if (!booking) throw new RentalPaymentUnavailableError('Rental booking is not available in this organization.');
    if (booking.status !== 'CONFIRMED') throw new RentalPaymentConflictError('Refund rental payments before cancelling the rental booking.');

    const history = await transaction.rentalPaymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: booking.id },
      select: paymentHistorySelect,
    });
    const settlement = deriveRentalPaymentSettlement({ bookingTotalMinor: booking.totalMinor, currency: booking.currency, transactions: history });
    if (!settlement.reconciled) throw new RentalPaymentConflictError(settlement.reason);
    if (settlement.paymentState !== 'PAID' && settlement.paymentState !== 'PARTIALLY_REFUNDED') {
      throw new RentalPaymentConflictError(`Rental booking payment state ${settlement.paymentState.toLowerCase()} does not accept a refund.`);
    }

    const plan = deriveBookingRefundExecutionPlan({
      bookingPaymentStatus: settlement.paymentState,
      bookingTotalMinor: booking.totalMinor,
      currency: booking.currency,
      transactions: history,
      expectedProviderCode: 'manual',
      requestedAmountMinor: null,
    });
    if (!plan.planned) throw new RentalPaymentConflictError(plan.reason);
    if (plan.sourceKind !== 'OFFLINE_PAYMENT') throw new RentalPaymentConflictError('Rental manual refund did not resolve to a successful offline payment source.');

    const duplicateReference = await transaction.rentalPaymentTransaction.findFirst({
      where: { organizationId: input.organizationId, providerCode: manualProvider.code, providerReference: refundReference },
      select: { id: true },
    });
    if (duplicateReference) throw new RentalPaymentConflictError('Manual refund reference has already been recorded in this organization.');
    if (!manualProvider.recordOfflineRefund) throw new RentalPaymentConflictError('Manual payment provider cannot record refunds.');

    const providerResult = await manualProvider.recordOfflineRefund({
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      money: { currency: booking.currency, amountMinor: plan.amountMinor },
      paymentReference: plan.sourceProviderReference,
      refundReference,
    });
    if (providerResult.status !== 'REFUNDED' || providerResult.providerReference !== plan.sourceProviderReference || providerResult.refundReference !== refundReference || providerResult.money.currency !== booking.currency || providerResult.money.amountMinor !== plan.amountMinor) {
      throw new RentalPaymentConflictError('Manual payment provider returned a refund result that does not match the authoritative rental refund plan.');
    }

    const refund = await transaction.rentalPaymentTransaction.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey,
        kind: 'REFUND',
        status: 'SUCCEEDED',
        providerCode: providerResult.providerCode,
        providerReference: providerResult.refundReference,
        sourceProviderReference: plan.sourceProviderReference,
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

  const booking = await db.rentalBooking.findFirst({
    where: { id: input.bookingId, organizationId: input.organizationId },
    select: { id: true, status: true, currency: true, totalMinor: true },
  });
  if (!booking) throw new RentalPaymentUnavailableError('Rental booking is not available in this organization.');

  const pagination = normalizePagination(input.page ?? 1, input.pageSize ?? 25);
  const where = { organizationId: input.organizationId, bookingId: input.bookingId };
  const [total, settlementHistory] = await Promise.all([
    db.rentalPaymentTransaction.count({ where }),
    db.rentalPaymentTransaction.findMany({ where, select: paymentHistorySelect }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
  const page = Math.min(pagination.page, totalPages);
  const transactions = await db.rentalPaymentTransaction.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pagination.pageSize, take: pagination.pageSize });
  const settlement = deriveRentalPaymentSettlement({ bookingTotalMinor: booking.totalMinor, currency: booking.currency, transactions: settlementHistory });
  return Object.freeze({ booking, transactions, settlement, total, page, pageSize: pagination.pageSize, totalPages });
}
