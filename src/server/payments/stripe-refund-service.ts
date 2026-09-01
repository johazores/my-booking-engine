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

const PROVIDER = 'stripe';
const REFUND_REFERENCE = /^re_[A-Za-z0-9_]+$/;

type RefundMode = 'explicit' | 'remaining';
type ExistingRefund = {
  id: string;
  bookingId: string;
  kind: string;
  status: string;
  providerCode: string;
  providerReference: string;
  currency: string;
  amountMinor: bigint;
  requestFingerprint: string | null;
};

export type StripeRefundSourceCandidate = Readonly<{
  id: string;
  bookingId: string;
  kind: string;
  status: string;
  providerCode: string;
  providerReference: string;
  currency: string;
  amountMinor: bigint;
}>;

function lockKey(organizationId: string, scope: string, value: string) {
  return `payment:${organizationId}:${scope}:${value}`;
}

export function normalizeStripeRefundAmount(value: unknown): bigint | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'bigint' && value > 0n) return value;
  if (typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) > 0n) return BigInt(value);
  throw new Error('Refund amount must be a positive integer minor-unit value.');
}

export function stripeRefundPersistenceStatus(status: ProviderRefundResult['status']): 'PENDING' | 'SUCCEEDED' | 'FAILED' {
  return status === 'REFUNDED' ? 'SUCCEEDED' : status === 'PENDING' ? 'PENDING' : 'FAILED';
}

export function stripeRefundRequestFingerprint(input: {
  bookingId: string;
  currency: string;
  amountMinor: bigint;
  sourceProviderReference: string;
  mode: RefundMode;
}) {
  return paymentRequestFingerprint([
    PROVIDER,
    'refund',
    input.bookingId,
    input.currency,
    input.amountMinor.toString(),
    input.sourceProviderReference,
    input.mode,
  ]);
}

export function nextStripeRefundBookingPaymentStatus(input: {
  sourceAmountMinor: bigint;
  refundedBeforeMinor: bigint;
  refundAmountMinor: bigint;
}): 'PARTIALLY_REFUNDED' | 'REFUNDED' {
  if (input.sourceAmountMinor <= 0n || input.refundedBeforeMinor < 0n || input.refundAmountMinor <= 0n) {
    throw new Error('Stripe refund amounts are invalid.');
  }
  const total = input.refundedBeforeMinor + input.refundAmountMinor;
  if (total > input.sourceAmountMinor) throw new PaymentConflictError('Refund amount exceeds the remaining refundable balance.');
  return total === input.sourceAmountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}

export function selectStripeRefundSource(
  candidates: readonly StripeRefundSourceCandidate[],
  options: { allowAuthorizationFallback: boolean },
): StripeRefundSourceCandidate | null {
  const eligible = candidates.filter((candidate) => (
    candidate.providerCode === PROVIDER
    && candidate.status === 'SUCCEEDED'
    && !isInternalPaymentClaimReference(candidate.providerReference)
  ));
  const captures = eligible.filter((candidate) => candidate.kind === 'CAPTURE');
  if (captures.length > 1) throw new PaymentConflictError('Stripe refund source matches multiple successful captures.');
  if (captures.length === 1) return captures[0];
  if (!options.allowAuthorizationFallback) return null;

  const settledAuthorizations = eligible.filter((candidate) => candidate.kind === 'AUTHORIZATION');
  if (settledAuthorizations.length > 1) {
    throw new PaymentConflictError('Stripe refund source matches multiple successful settled authorizations.');
  }
  return settledAuthorizations[0] ?? null;
}

function assertExisting(existing: ExistingRefund, expected: {
  bookingId: string;
  currency?: string;
  amountMinor?: bigint;
  fingerprint?: string;
}) {
  if (
    existing.bookingId !== expected.bookingId
    || existing.kind !== 'REFUND'
    || existing.providerCode !== PROVIDER
    || (expected.currency !== undefined && existing.currency !== expected.currency)
    || (expected.amountMinor !== undefined && existing.amountMinor !== expected.amountMinor)
    || (expected.fingerprint !== undefined && existing.requestFingerprint !== expected.fingerprint)
  ) throw new PaymentConflictError('Payment idempotency key was already used for a different operation.');
}

async function failInternalClaim(input: { organizationId: string; actorUserId: string; bookingId: string; refundId: string }) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.organizationId, 'booking', input.bookingId)}, 0))`;
    const refund = await tx.paymentTransaction.findFirst({
      where: { id: input.refundId, organizationId: input.organizationId, bookingId: input.bookingId, kind: 'REFUND' },
    });
    if (!refund || refund.status !== 'PENDING' || !isInternalPaymentClaimReference(refund.providerReference)) return;
    await tx.paymentTransaction.update({ where: { id: refund.id }, data: { status: 'FAILED' } });
    await tx.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'payment.refund-failed',
      resourceType: 'payment-transaction',
      resourceId: refund.id,
      afterData: { bookingId: input.bookingId, providerCode: PROVIDER, kind: 'REFUND', status: 'FAILED' },
    } });
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
  const requestedAmount = normalizeStripeRefundAmount(input.amountMinor);
  const mode: RefundMode = requestedAmount === null ? 'remaining' : 'explicit';

  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' });

  const [booking, prior] = await Promise.all([
    db.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true },
    }),
    db.paymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    }),
  ]);
  if (!booking) throw new PaymentUnavailableError('Booking is not available in this organization.');
  if (prior) assertExisting(prior, { bookingId: booking.id });

  const sourceCandidates = await db.paymentTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: booking.id,
      kind: { in: ['CAPTURE', 'AUTHORIZATION'] },
      status: 'SUCCEEDED',
      providerCode: PROVIDER,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 4,
  });
  const source = selectStripeRefundSource(sourceCandidates, {
    allowAuthorizationFallback: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(booking.paymentStatus),
  });
  if (!source) throw new PaymentConflictError('No successful settled Stripe payment is available to refund.');
  if (source.currency !== booking.currency || source.amountMinor !== booking.totalMinor) {
    throw new PaymentConflictError('Stripe settlement does not match the authoritative booking total.');
  }

  if (prior && (prior.status !== 'PENDING' || !isInternalPaymentClaimReference(prior.providerReference))) {
    const retryAmount = requestedAmount ?? prior.amountMinor;
    assertExisting(prior, {
      bookingId: booking.id,
      currency: booking.currency,
      amountMinor: retryAmount,
      fingerprint: stripeRefundRequestFingerprint({
        bookingId: booking.id,
        currency: booking.currency,
        amountMinor: retryAmount,
        sourceProviderReference: source.providerReference,
        mode,
      }),
    });
    return prior;
  }

  if (booking.status !== 'CONFIRMED') throw new PaymentConflictError('Only confirmed bookings can receive a Stripe refund.');
  if (!['PAID', 'PARTIALLY_REFUNDED'].includes(booking.paymentStatus)) {
    throw new PaymentConflictError(`Booking payment state ${booking.paymentStatus.toLowerCase()} does not accept a refund.`);
  }

  const succeeded = await db.paymentTransaction.aggregate({
    where: { organizationId: input.organizationId, bookingId: booking.id, kind: 'REFUND', status: 'SUCCEEDED', providerCode: PROVIDER },
    _sum: { amountMinor: true },
  });
  const refundedMinor = succeeded._sum.amountMinor ?? 0n;
  const remainingMinor = source.amountMinor - refundedMinor;
  if (remainingMinor <= 0n) throw new PaymentConflictError('Stripe payment has already been fully refunded.');
  const amountMinor = requestedAmount ?? remainingMinor;
  if (amountMinor > remainingMinor) throw new PaymentConflictError('Refund amount exceeds the remaining refundable balance.');

  const fingerprint = stripeRefundRequestFingerprint({
    bookingId: booking.id,
    currency: booking.currency,
    amountMinor,
    sourceProviderReference: source.providerReference,
    mode,
  });
  const claimReference = paymentOperationClaimReference(fingerprint);
  if (prior) assertExisting(prior, { bookingId: booking.id, currency: booking.currency, amountMinor, fingerprint });

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  if (!stripe.integration.capabilities.includes('payment-refund')) throw new PaymentConflictError('Stripe integration is not configured for payment-refund.');
  assertPaymentProviderCapability(stripe.provider, 'REFUND');
  if (!stripe.provider.refundPayment) throw new PaymentConflictError('Stripe integration cannot refund payments.');

  const claim = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.organizationId, 'booking', booking.id)}, 0))`;

    const existing = await tx.paymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (existing) {
      assertExisting(existing, { bookingId: booking.id, currency: booking.currency, amountMinor, fingerprint });
      return { refund: existing, callProvider: existing.status === 'PENDING' && existing.providerReference === claimReference } as const;
    }

    const currentBooking = await tx.hospitalityBooking.findFirst({
      where: { id: booking.id, organizationId: input.organizationId },
      select: { status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!currentBooking || currentBooking.status !== 'CONFIRMED' || currentBooking.currency !== booking.currency || currentBooking.totalMinor !== booking.totalMinor) {
      throw new PaymentConflictError('Booking changed before the Stripe refund could be claimed.');
    }
    if (!['PAID', 'PARTIALLY_REFUNDED'].includes(currentBooking.paymentStatus)) {
      throw new PaymentConflictError(`Booking payment state ${currentBooking.paymentStatus.toLowerCase()} no longer accepts a refund.`);
    }

    const currentSource = await tx.paymentTransaction.findFirst({
      where: {
        id: source.id,
        organizationId: input.organizationId,
        bookingId: booking.id,
        kind: source.kind as 'CAPTURE' | 'AUTHORIZATION',
        status: 'SUCCEEDED',
        providerCode: PROVIDER,
        providerReference: source.providerReference,
      },
    });
    if (!currentSource || currentSource.currency !== booking.currency || currentSource.amountMinor !== source.amountMinor) {
      throw new PaymentConflictError('Stripe settlement changed before the refund could be claimed.');
    }
    if (source.kind === 'AUTHORIZATION' && !['PAID', 'PARTIALLY_REFUNDED'].includes(currentBooking.paymentStatus)) {
      throw new PaymentConflictError('Stripe authorization is not proven settled for this booking.');
    }
    if (await tx.paymentTransaction.findFirst({
      where: { organizationId: input.organizationId, bookingId: booking.id, kind: 'REFUND', status: 'PENDING', providerCode: PROVIDER },
      select: { id: true },
    })) throw new PaymentConflictError('Booking already has a pending Stripe refund that must resolve before another refund can start.');

    const currentRefunds = await tx.paymentTransaction.aggregate({
      where: { organizationId: input.organizationId, bookingId: booking.id, kind: 'REFUND', status: 'SUCCEEDED', providerCode: PROVIDER },
      _sum: { amountMinor: true },
    });
    if (amountMinor > currentSource.amountMinor - (currentRefunds._sum.amountMinor ?? 0n)) {
      throw new PaymentConflictError('Refund amount exceeds the remaining refundable balance.');
    }

    const refund = await tx.paymentTransaction.create({ data: {
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      requestFingerprint: fingerprint,
      kind: 'REFUND',
      status: 'PENDING',
      providerCode: PROVIDER,
      providerReference: claimReference,
      currency: booking.currency,
      amountMinor,
    } });
    return { refund, callProvider: true } as const;
  }, { isolationLevel: 'Serializable' });

  if (!claim.callProvider) return claim.refund;

  let result: ProviderRefundResult;
  try {
    result = await stripe.provider.refundPayment({
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      money: { currency: booking.currency, amountMinor },
      providerReference: source.providerReference,
    });
  } catch (error) {
    if (error instanceof PaymentProviderError && !error.retryable) {
      await failInternalClaim({ organizationId: input.organizationId, actorUserId: input.actorUserId, bookingId: booking.id, refundId: claim.refund.id });
    }
    throw error;
  }

  if (result.providerCode !== PROVIDER || result.providerReference !== source.providerReference || result.money.currency !== booking.currency || result.money.amountMinor !== amountMinor) {
    throw new PaymentConflictError('Stripe returned a refund result that does not match the requested refund.');
  }
  if (!REFUND_REFERENCE.test(result.refundReference)) throw new PaymentConflictError('Stripe returned an invalid refund reference.');
  const transactionStatus = stripeRefundPersistenceStatus(result.status);

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.organizationId, 'booking', booking.id)}, 0))`;
    const existing = await tx.paymentTransaction.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } } });
    if (!existing) throw new PaymentConflictError('Stripe refund claim disappeared before persistence.');
    assertExisting(existing, { bookingId: booking.id, currency: booking.currency, amountMinor, fingerprint });
    if (existing.providerReference !== claimReference) return existing;

    if (await tx.paymentTransaction.findFirst({
      where: { organizationId: input.organizationId, providerCode: PROVIDER, providerReference: result.refundReference, id: { not: existing.id } },
      select: { id: true },
    })) throw new PaymentConflictError('Stripe refund reference has already been recorded in this organization.');

    const currentBooking = await tx.hospitalityBooking.findFirst({
      where: { id: booking.id, organizationId: input.organizationId },
      select: { status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!currentBooking || currentBooking.status !== 'CONFIRMED' || currentBooking.currency !== booking.currency || currentBooking.totalMinor !== booking.totalMinor) {
      throw new PaymentConflictError('Booking changed while the Stripe refund was being processed.');
    }

    const refund = await tx.paymentTransaction.update({
      where: { id: existing.id },
      data: { status: transactionStatus, providerReference: result.refundReference },
    });
    let bookingPaymentStatus = currentBooking.paymentStatus;
    if (transactionStatus === 'SUCCEEDED') {
      const previous = await tx.paymentTransaction.aggregate({
        where: { organizationId: input.organizationId, bookingId: booking.id, kind: 'REFUND', status: 'SUCCEEDED', providerCode: PROVIDER, id: { not: refund.id } },
        _sum: { amountMinor: true },
      });
      bookingPaymentStatus = nextStripeRefundBookingPaymentStatus({
        sourceAmountMinor: source.amountMinor,
        refundedBeforeMinor: previous._sum.amountMinor ?? 0n,
        refundAmountMinor: amountMinor,
      });
      await tx.hospitalityBooking.update({ where: { id: booking.id }, data: { paymentStatus: bookingPaymentStatus } });
    }
    await tx.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: transactionStatus === 'SUCCEEDED' ? 'payment.refund-recorded' : transactionStatus === 'FAILED' ? 'payment.refund-failed' : 'payment.refund-pending',
      resourceType: 'payment-transaction',
      resourceId: refund.id,
      afterData: {
        bookingId: booking.id,
        providerCode: PROVIDER,
        kind: 'REFUND',
        status: transactionStatus,
        currency: refund.currency,
        amountMinor: refund.amountMinor.toString(),
        bookingPaymentStatus,
      },
    } });
    return refund;
  }, { isolationLevel: 'Serializable' });
}
