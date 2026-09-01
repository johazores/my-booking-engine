import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadStripePaymentIntegration } from '../integrations/stripe-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { PaymentConflictError, PaymentUnavailableError } from './payment-service.ts';
import {
  PaymentProviderError,
  assertPaymentProviderCapability,
  normalizePaymentIdempotencyKey,
  type ProviderRefundResult,
} from './payment-provider.ts';
import {
  isInternalPaymentClaimReference,
  paymentOperationClaimReference,
  paymentRequestFingerprint,
} from './stripe-payment-service.ts';

const STRIPE_PROVIDER_CODE = 'stripe';
const STRIPE_REFUND_REFERENCE_PATTERN = /^re_[A-Za-z0-9_]+$/;

type BookingSnapshot = Readonly<{
  id: string;
  status: string;
  paymentStatus: string;
  currency: string;
  totalMinor: bigint;
}>;

type ExistingRefund = Readonly<{
  id: string;
  bookingId: string;
  kind: string;
  status: string;
  providerCode: string;
  providerReference: string;
  currency: string;
  amountMinor: bigint;
  requestFingerprint: string | null;
}>;

function paymentLockKey(organizationId: string, scope: string, value: string) {
  return `payment:${organizationId}:${scope}:${value}`;
}

export function normalizeStripeRefundAmount(value: unknown): bigint | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'bigint') {
    if (value <= 0n) throw new Error('Refund amount must be greater than zero.');
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const amount = BigInt(value);
    if (amount <= 0n) throw new Error('Refund amount must be greater than zero.');
    return amount;
  }
  throw new Error('Refund amount must be a positive integer minor-unit value.');
}

export function stripeRefundPersistenceStatus(status: ProviderRefundResult['status']): 'PENDING' | 'SUCCEEDED' | 'FAILED' {
  if (status === 'REFUNDED') return 'SUCCEEDED';
  if (status === 'PENDING') return 'PENDING';
  return 'FAILED';
}

export function nextStripeRefundBookingPaymentStatus(input: {
  sourceAmountMinor: bigint;
  refundedBeforeMinor: bigint;
  refundAmountMinor: bigint;
}): 'PARTIALLY_REFUNDED' | 'REFUNDED' {
  if (input.sourceAmountMinor <= 0n) throw new Error('Stripe source payment amount must be greater than zero.');
  if (input.refundedBeforeMinor < 0n || input.refundAmountMinor <= 0n) throw new Error('Stripe refund amounts are invalid.');
  const nextRefundedMinor = input.refundedBeforeMinor + input.refundAmountMinor;
  if (nextRefundedMinor > input.sourceAmountMinor) throw new PaymentConflictError('Refund amount exceeds the remaining refundable balance.');
  return nextRefundedMinor === input.sourceAmountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}

function assertExactExistingRefund(existing: ExistingRefund, expected: {
  bookingId: string;
  currency?: string;
  amountMinor?: bigint;
  requestFingerprint?: string;
}): void {
  if (
    existing.bookingId !== expected.bookingId
    || existing.kind !== 'REFUND'
    || existing.providerCode !== STRIPE_PROVIDER_CODE
    || (expected.currency !== undefined && existing.currency !== expected.currency)
    || (expected.amountMinor !== undefined && existing.amountMinor !== expected.amountMinor)
    || (expected.requestFingerprint !== undefined && existing.requestFingerprint !== expected.requestFingerprint)
  ) {
    throw new PaymentConflictError('Payment idempotency key was already used for a different operation.');
  }
}

function normalizeStripeRefundReference(value: unknown): string {
  if (typeof value !== 'string' || !STRIPE_REFUND_REFERENCE_PATTERN.test(value.trim())) {
    throw new PaymentConflictError('Stripe returned an invalid refund reference.');
  }
  return value.trim();
}

async function loadBooking(organizationId: string, bookingId: string): Promise<BookingSnapshot> {
  const booking = await db.hospitalityBooking.findFirst({
    where: { id: bookingId, organizationId },
    select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true },
  });
  if (!booking) throw new PaymentUnavailableError('Booking is not available in this organization.');
  return booking;
}

async function markRefundClaimFailed(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  refundId: string;
}) {
  await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'booking', input.bookingId)}, 0))`;
    const refund = await transaction.paymentTransaction.findFirst({
      where: { id: input.refundId, organizationId: input.organizationId, bookingId: input.bookingId, kind: 'REFUND' },
    });
    if (!refund || refund.status !== 'PENDING' || !isInternalPaymentClaimReference(refund.providerReference)) return;

    await transaction.paymentTransaction.update({ where: { id: refund.id }, data: { status: 'FAILED' } });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.refund-failed',
        resourceType: 'payment-transaction',
        resourceId: refund.id,
        afterData: {
          bookingId: input.bookingId,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: 'REFUND',
          status: 'FAILED',
        },
      },
    });
  }, { isolationLevel: 'Serializable' });
}

export async function refundStripeBookingPayment(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  idempotencyKey: unknown;
  amountMinor?: unknown;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const idempotencyKey = normalizePaymentIdempotencyKey(input.idempotencyKey);
  const requestedAmountMinor = normalizeStripeRefundAmount(input.amountMinor);

  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:manage',
  });

  const prior = await db.paymentTransaction.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
  });
  if (prior && (!isInternalPaymentClaimReference(prior.providerReference) || prior.status !== 'PENDING')) {
    assertExactExistingRefund(prior, {
      bookingId: input.bookingId,
      amountMinor: requestedAmountMinor ?? undefined,
    });
    return prior;
  }

  const booking = await loadBooking(input.organizationId, input.bookingId);
  if (booking.status !== 'CONFIRMED') throw new PaymentConflictError('Only confirmed bookings can receive a Stripe refund.');
  if (booking.paymentStatus !== 'PAID' && booking.paymentStatus !== 'PARTIALLY_REFUNDED') {
    throw new PaymentConflictError(`Booking payment state ${booking.paymentStatus.toLowerCase()} does not accept a refund.`);
  }

  const sourcePayment = await db.paymentTransaction.findFirst({
    where: {
      organizationId: input.organizationId,
      bookingId: booking.id,
      kind: 'CAPTURE',
      status: 'SUCCEEDED',
      providerCode: STRIPE_PROVIDER_CODE,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (!sourcePayment || isInternalPaymentClaimReference(sourcePayment.providerReference)) {
    throw new PaymentConflictError('No successful Stripe capture is available to refund.');
  }
  if (sourcePayment.currency !== booking.currency || sourcePayment.amountMinor !== booking.totalMinor) {
    throw new PaymentConflictError('Stripe capture does not match the authoritative booking total.');
  }

  const refunded = await db.paymentTransaction.aggregate({
    where: {
      organizationId: input.organizationId,
      bookingId: booking.id,
      kind: 'REFUND',
      status: 'SUCCEEDED',
      providerCode: STRIPE_PROVIDER_CODE,
    },
    _sum: { amountMinor: true },
  });
  const refundedMinor = refunded._sum.amountMinor ?? 0n;
  const refundableMinor = sourcePayment.amountMinor - refundedMinor;
  if (refundableMinor <= 0n) throw new PaymentConflictError('Stripe payment has already been fully refunded.');
  const amountMinor = requestedAmountMinor ?? refundableMinor;
  if (amountMinor > refundableMinor) throw new PaymentConflictError('Refund amount exceeds the remaining refundable balance.');

  const requestFingerprint = paymentRequestFingerprint([
    STRIPE_PROVIDER_CODE,
    'refund',
    booking.id,
    booking.currency,
    amountMinor.toString(),
    sourcePayment.providerReference,
  ]);
  const claimReference = paymentOperationClaimReference(requestFingerprint);
  if (prior) {
    assertExactExistingRefund(prior, {
      bookingId: booking.id,
      currency: booking.currency,
      amountMinor,
      requestFingerprint,
    });
    if (prior.providerReference !== claimReference) return prior;
  }

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  if (!stripe.integration.capabilities.includes('payment-refund')) {
    throw new PaymentConflictError('Stripe integration is not configured for payment-refund.');
  }
  assertPaymentProviderCapability(stripe.provider, 'REFUND');
  if (!stripe.provider.refundPayment) throw new PaymentConflictError('Stripe integration cannot refund payments.');

  const claim = await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'booking', booking.id)}, 0))`;

    const existing = await transaction.paymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (existing) {
      assertExactExistingRefund(existing, {
        bookingId: booking.id,
        currency: booking.currency,
        amountMinor,
        requestFingerprint,
      });
      if (existing.status !== 'PENDING' || existing.providerReference !== claimReference) {
        return { refund: existing, callProvider: false } as const;
      }
      return { refund: existing, callProvider: true } as const;
    }

    const currentBooking = await transaction.hospitalityBooking.findFirst({
      where: { id: booking.id, organizationId: input.organizationId },
      select: { status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!currentBooking) throw new PaymentUnavailableError('Booking is not available in this organization.');
    if (
      currentBooking.status !== 'CONFIRMED'
      || currentBooking.currency !== booking.currency
      || currentBooking.totalMinor !== booking.totalMinor
    ) {
      throw new PaymentConflictError('Booking changed before the Stripe refund could be claimed.');
    }
    if (currentBooking.paymentStatus !== 'PAID' && currentBooking.paymentStatus !== 'PARTIALLY_REFUNDED') {
      throw new PaymentConflictError(`Booking payment state ${currentBooking.paymentStatus.toLowerCase()} no longer accepts a refund.`);
    }

    const currentSource = await transaction.paymentTransaction.findFirst({
      where: {
        id: sourcePayment.id,
        organizationId: input.organizationId,
        bookingId: booking.id,
        kind: 'CAPTURE',
        status: 'SUCCEEDED',
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: sourcePayment.providerReference,
      },
    });
    if (!currentSource || currentSource.currency !== booking.currency || currentSource.amountMinor !== sourcePayment.amountMinor) {
      throw new PaymentConflictError('Stripe capture changed before the refund could be claimed.');
    }

    const pendingRefund = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        kind: 'REFUND',
        status: 'PENDING',
        providerCode: STRIPE_PROVIDER_CODE,
      },
      select: { id: true },
    });
    if (pendingRefund) throw new PaymentConflictError('Booking already has a pending Stripe refund that must resolve before another refund can start.');

    const currentRefunded = await transaction.paymentTransaction.aggregate({
      where: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        kind: 'REFUND',
        status: 'SUCCEEDED',
        providerCode: STRIPE_PROVIDER_CODE,
      },
      _sum: { amountMinor: true },
    });
    const currentRefundedMinor = currentRefunded._sum.amountMinor ?? 0n;
    if (amountMinor > currentSource.amountMinor - currentRefundedMinor) {
      throw new PaymentConflictError('Refund amount exceeds the remaining refundable balance.');
    }

    const refund = await transaction.paymentTransaction.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey,
        requestFingerprint,
        kind: 'REFUND',
        status: 'PENDING',
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: claimReference,
        currency: booking.currency,
        amountMinor,
      },
    });
    return { refund, callProvider: true } as const;
  }, { isolationLevel: 'Serializable' });

  if (!claim.callProvider) return claim.refund;

  let providerResult: ProviderRefundResult;
  try {
    providerResult = await stripe.provider.refundPayment({
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      money: { currency: booking.currency, amountMinor },
      providerReference: sourcePayment.providerReference,
    });
  } catch (error) {
    if (error instanceof PaymentProviderError && !error.retryable) {
      await markRefundClaimFailed({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        bookingId: booking.id,
        refundId: claim.refund.id,
      });
    }
    throw error;
  }

  if (
    providerResult.providerCode !== STRIPE_PROVIDER_CODE
    || providerResult.providerReference !== sourcePayment.providerReference
    || providerResult.money.currency !== booking.currency
    || providerResult.money.amountMinor !== amountMinor
  ) {
    throw new PaymentConflictError('Stripe returned a refund result that does not match the requested refund.');
  }
  const refundReference = normalizeStripeRefundReference(providerResult.refundReference);
  const transactionStatus = stripeRefundPersistenceStatus(providerResult.status);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'booking', booking.id)}, 0))`;

    const existing = await transaction.paymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (!existing) throw new PaymentConflictError('Stripe refund claim disappeared before persistence.');
    assertExactExistingRefund(existing, {
      bookingId: booking.id,
      currency: booking.currency,
      amountMinor,
      requestFingerprint,
    });
    if (existing.providerReference !== claimReference) return existing;

    const duplicateReference = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: refundReference,
        id: { not: existing.id },
      },
      select: { id: true },
    });
    if (duplicateReference) throw new PaymentConflictError('Stripe refund reference has already been recorded in this organization.');

    const currentBooking = await transaction.hospitalityBooking.findFirst({
      where: { id: booking.id, organizationId: input.organizationId },
      select: { status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!currentBooking) throw new PaymentUnavailableError('Booking is not available in this organization.');
    if (
      currentBooking.status !== 'CONFIRMED'
      || currentBooking.currency !== booking.currency
      || currentBooking.totalMinor !== booking.totalMinor
    ) {
      throw new PaymentConflictError('Booking changed while the Stripe refund was being processed.');
    }

    const refund = await transaction.paymentTransaction.update({
      where: { id: existing.id },
      data: { status: transactionStatus, providerReference: refundReference },
    });

    let bookingPaymentStatus = currentBooking.paymentStatus;
    if (transactionStatus === 'SUCCEEDED') {
      const refundedBefore = await transaction.paymentTransaction.aggregate({
        where: {
          organizationId: input.organizationId,
          bookingId: booking.id,
          kind: 'REFUND',
          status: 'SUCCEEDED',
          providerCode: STRIPE_PROVIDER_CODE,
          id: { not: refund.id },
        },
        _sum: { amountMinor: true },
      });
      bookingPaymentStatus = nextStripeRefundBookingPaymentStatus({
        sourceAmountMinor: sourcePayment.amountMinor,
        refundedBeforeMinor: refundedBefore._sum.amountMinor ?? 0n,
        refundAmountMinor: amountMinor,
      });
      await transaction.hospitalityBooking.update({
        where: { id: booking.id },
        data: { paymentStatus: bookingPaymentStatus },
      });
    }

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: transactionStatus === 'SUCCEEDED' ? 'payment.refund-recorded' : transactionStatus === 'FAILED' ? 'payment.refund-failed' : 'payment.refund-pending',
        resourceType: 'payment-transaction',
        resourceId: refund.id,
        afterData: {
          bookingId: booking.id,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: 'REFUND',
          status: transactionStatus,
          currency: refund.currency,
          amountMinor: refund.amountMinor.toString(),
          bookingPaymentStatus,
        },
      },
    });

    return refund;
  }, { isolationLevel: 'Serializable' });
}
