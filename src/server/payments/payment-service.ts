import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { ManualPaymentProvider, normalizeManualPaymentReference } from './manual-payment-provider.ts';
import {
  assertPaymentProviderCapability,
  normalizePaymentIdempotencyKey,
} from './payment-provider.ts';

export class PaymentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentConflictError';
  }
}

export class PaymentUnavailableError extends Error {
  constructor(message = 'Payment resource is not available in this organization.') {
    super(message);
    this.name = 'PaymentUnavailableError';
  }
}

const manualProvider = new ManualPaymentProvider();

function paymentLockKey(organizationId: string, scope: string, value: string) {
  return `payment:${organizationId}:${scope}:${value}`;
}

function normalizePagination(page: number, pageSize: number) {
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 25;
  return { page: safePage, pageSize: safePageSize };
}

export async function recordManualOfflinePayment(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  idempotencyKey: unknown;
  reference: unknown;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const idempotencyKey = normalizePaymentIdempotencyKey(input.idempotencyKey);
  const reference = normalizeManualPaymentReference(input.reference);

  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:manage',
  });
  assertPaymentProviderCapability(manualProvider, 'OFFLINE_RECORDING');

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;

    const existing = await transaction.paymentTransaction.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        existing.bookingId !== input.bookingId
        || existing.kind !== 'OFFLINE_PAYMENT'
        || existing.providerCode !== manualProvider.code
        || existing.providerReference !== reference
      ) {
        throw new PaymentConflictError('Payment idempotency key was already used for a different operation.');
      }
      return existing;
    }

    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'booking', input.bookingId)}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'manual-reference', reference)}, 0))`;

    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        currency: true,
        totalMinor: true,
      },
    });
    if (!booking) throw new PaymentUnavailableError('Booking is not available in this organization.');
    if (booking.status !== 'CONFIRMED') {
      throw new PaymentConflictError('Only confirmed bookings can receive an offline payment.');
    }
    if (booking.totalMinor <= 0n) {
      throw new PaymentConflictError('A zero-value booking does not require an offline payment.');
    }
    if (booking.paymentStatus !== 'UNPAID' && booking.paymentStatus !== 'FAILED') {
      throw new PaymentConflictError(`Booking payment state ${booking.paymentStatus.toLowerCase()} does not accept a new offline payment.`);
    }

    const duplicateReference = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        providerCode: manualProvider.code,
        providerReference: reference,
      },
      select: { id: true },
    });
    if (duplicateReference) {
      throw new PaymentConflictError('Manual payment reference has already been recorded in this organization.');
    }

    const providerResult = await manualProvider.recordOfflinePayment({
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      money: { currency: booking.currency, amountMinor: booking.totalMinor },
      reference,
    });
    if (
      providerResult.status !== 'PAID'
      || providerResult.money.currency !== booking.currency
      || providerResult.money.amountMinor !== booking.totalMinor
    ) {
      throw new PaymentConflictError('Manual payment provider returned a result that does not match the authoritative booking total.');
    }

    const payment = await transaction.paymentTransaction.create({
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

    await transaction.hospitalityBooking.update({
      where: { id: booking.id },
      data: { paymentStatus: 'PAID' },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.offline-recorded',
        resourceType: 'payment-transaction',
        resourceId: payment.id,
        afterData: {
          bookingId: booking.id,
          providerCode: payment.providerCode,
          kind: payment.kind,
          status: payment.status,
          currency: payment.currency,
          amountMinor: payment.amountMinor.toString(),
          bookingPaymentStatus: 'PAID',
        },
      },
    });

    return payment;
  }, { isolationLevel: 'Serializable' });
}

export async function listBookingPaymentTransactions(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  page?: number;
  pageSize?: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:read',
  });

  const booking = await db.hospitalityBooking.findFirst({
    where: { id: input.bookingId, organizationId: input.organizationId },
    select: { id: true, paymentStatus: true, currency: true, totalMinor: true },
  });
  if (!booking) throw new PaymentUnavailableError('Booking is not available in this organization.');

  const pagination = normalizePagination(input.page ?? 1, input.pageSize ?? 25);
  const where = { organizationId: input.organizationId, bookingId: input.bookingId };
  const total = await db.paymentTransaction.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
  const page = Math.min(pagination.page, totalPages);
  const transactions = await db.paymentTransaction.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * pagination.pageSize,
    take: pagination.pageSize,
  });

  return { booking, transactions, total, page, totalPages };
}
