import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import {
  ACTIVE_COMMERCIAL_AMENDMENT_CONFLICT_MESSAGE,
  findActiveHospitalityBookingCommercialAmendment,
} from '../bookings/hospitality-booking-commercial-amendment-guard.ts';
import { hospitalityBookingMutationLockKey } from '../bookings/hospitality-booking-mutation-lock.ts';
import { db } from '../database.ts';
import { loadStripePaymentIntegration } from '../integrations/stripe-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveBookingRefundExecutionPlan } from './payment-refund-execution-domain.ts';
import { deriveBookingPaymentStatusFromSettlementTransactions } from './payment-refund-state-domain.ts';
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
  sourceProviderReference: string | null;
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
  sourceProviderReference?: string;
}) {
  if (
    existing.bookingId !== expected.bookingId
    || existing.kind !== 'REFUND'
    || existing.providerCode !== PROVIDER
    || (expected.currency !== undefined && existing.currency !== expected.currency)
    || (expected.amountMinor !== undefined && existing.amountMinor !== expected.amountMinor)
    || (expected.fingerprint !== undefined && existing.requestFingerprint !== expected.fingerprint)
    || (expected.sourceProviderReference !== undefined && existing.sourceProviderReference !== expected.sourceProviderReference)
  ) throw new PaymentConflictError('Payment idempotency key was already used for a different operation.');
}

function requirePersistedRefundSource(refund: ExistingRefund) {
  const source = refund.sourceProviderReference?.trim();
  if (!source || isInternalPaymentClaimReference(source)) {
    throw new PaymentConflictError('Stripe refund is missing its authoritative settlement-source reference.');
  }
  return source;
}

function requireStripeRefundPlan(input: {
  bookingPaymentStatus: string;
  bookingTotalMinor: bigint;
  currency: string;
  transactions: readonly {
    kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
    providerCode: string;
    providerReference: string;
    sourceProviderReference?: string | null;
    currency: string;
    amountMinor: bigint;
  }[];
  requestedAmountMinor: bigint | null;
}) {
  const plan = deriveBookingRefundExecutionPlan({
    ...input,
    expectedProviderCode: PROVIDER,
  });
  if (!plan.planned) throw new PaymentConflictError(plan.reason);
  if (plan.providerCode !== PROVIDER) throw new PaymentConflictError('Booking refund source is not a Stripe settlement.');
  return plan;
}

function requireReconciledBookingPaymentStatus(input: {
  bookingTotalMinor: bigint;
  currency: string;
  transactions: readonly {
    kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
    providerCode: string;
    providerReference: string;
    sourceProviderReference?: string | null;
    currency: string;
    amountMinor: bigint;
  }[];
}) {
  const result = deriveBookingPaymentStatusFromSettlementTransactions(input);
  if (result.reconciled === false) throw new PaymentConflictError(result.reason);
  return result.paymentStatus;
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
      afterData: {
        bookingId: input.bookingId,
        providerCode: PROVIDER,
        kind: 'REFUND',
        status: 'FAILED',
        sourceProviderReference: refund.sourceProviderReference,
      },
    } });
  }, { isolationLevel: 'Serializable' });
}

export async function refundStripeBookingPayment(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  idempotencyKey: unknown;
  amountMinor?: unknown;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const idempotencyKey = normalizePaymentIdempotencyKey(input.idempotencyKey);
  const requestedAmount = normalizeStripeRefundAmount(input.amountMinor);
  const mode: RefundMode = requestedAmount === null ? 'remaining' : 'explicit';
  const now = input.now ?? new Date();

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

  if (prior) {
    assertExisting(prior, { bookingId: booking.id });
    const priorSource = requirePersistedRefundSource(prior);
    const retryAmount = requestedAmount ?? prior.amountMinor;
    assertExisting(prior, {
      bookingId: booking.id,
      currency: prior.currency,
      amountMinor: retryAmount,
      sourceProviderReference: priorSource,
      fingerprint: stripeRefundRequestFingerprint({
        bookingId: booking.id,
        currency: prior.currency,
        amountMinor: retryAmount,
        sourceProviderReference: priorSource,
        mode,
      }),
    });
    if (prior.status !== 'PENDING' || !isInternalPaymentClaimReference(prior.providerReference)) return prior;
  }

  if (booking.status !== 'CONFIRMED') throw new PaymentConflictError('Only confirmed bookings can receive a Stripe refund.');
  if (!['PAID', 'PARTIALLY_REFUNDED'].includes(booking.paymentStatus)) {
    throw new PaymentConflictError(`Booking payment state ${booking.paymentStatus.toLowerCase()} does not accept a refund.`);
  }

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  if (!stripe.integration.capabilities.includes('payment-refund')) throw new PaymentConflictError('Stripe integration is not configured for payment-refund.');
  assertPaymentProviderCapability(stripe.provider, 'REFUND');
  if (!stripe.provider.refundPayment) throw new PaymentConflictError('Stripe integration cannot refund payments.');

  const claim = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({ organizationId: input.organizationId, bookingId: booking.id })}, 0))`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.organizationId, 'booking', booking.id)}, 0))`;

    const existing = await tx.paymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (existing) assertExisting(existing, { bookingId: booking.id });

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

    const activeAmendment = await findActiveHospitalityBookingCommercialAmendment({
      reader: tx,
      organizationId: input.organizationId,
      bookingId: booking.id,
      now,
    });
    if (activeAmendment) throw new PaymentConflictError(ACTIVE_COMMERCIAL_AMENDMENT_CONFLICT_MESSAGE);

    const ledger = await tx.paymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: booking.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (existing) {
      const sourceProviderReference = requirePersistedRefundSource(existing);
      const retryAmount = requestedAmount ?? existing.amountMinor;
      const fingerprint = stripeRefundRequestFingerprint({
        bookingId: booking.id,
        currency: currentBooking.currency,
        amountMinor: retryAmount,
        sourceProviderReference,
        mode,
      });
      assertExisting(existing, {
        bookingId: booking.id,
        currency: currentBooking.currency,
        amountMinor: retryAmount,
        sourceProviderReference,
        fingerprint,
      });
      if (existing.status !== 'PENDING' || !isInternalPaymentClaimReference(existing.providerReference)) {
        return { refund: existing, callProvider: false } as const;
      }

      const plan = requireStripeRefundPlan({
        bookingPaymentStatus: currentBooking.paymentStatus,
        bookingTotalMinor: currentBooking.totalMinor,
        currency: currentBooking.currency,
        transactions: ledger.filter((transaction) => transaction.id !== existing.id),
        requestedAmountMinor: existing.amountMinor,
      });
      if (
        plan.sourceProviderReference !== sourceProviderReference
        || plan.amountMinor !== existing.amountMinor
        || plan.currency !== existing.currency
      ) {
        throw new PaymentConflictError('Stripe refund retry no longer matches the authoritative settlement allocation.');
      }
      const claimReference = paymentOperationClaimReference(fingerprint);
      if (existing.providerReference !== claimReference) {
        throw new PaymentConflictError('Stripe refund retry claim does not match its idempotent request fingerprint.');
      }
      return {
        refund: existing,
        callProvider: true,
        sourceProviderReference,
        amountMinor: existing.amountMinor,
        fingerprint,
        nextPaymentStatus: plan.nextPaymentStatus,
      } as const;
    }

    const plan = requireStripeRefundPlan({
      bookingPaymentStatus: currentBooking.paymentStatus,
      bookingTotalMinor: currentBooking.totalMinor,
      currency: currentBooking.currency,
      transactions: ledger,
      requestedAmountMinor: requestedAmount,
    });
    const fingerprint = stripeRefundRequestFingerprint({
      bookingId: booking.id,
      currency: plan.currency,
      amountMinor: plan.amountMinor,
      sourceProviderReference: plan.sourceProviderReference,
      mode,
    });
    const claimReference = paymentOperationClaimReference(fingerprint);
    const refund = await tx.paymentTransaction.create({ data: {
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      requestFingerprint: fingerprint,
      kind: 'REFUND',
      status: 'PENDING',
      providerCode: PROVIDER,
      providerReference: claimReference,
      sourceProviderReference: plan.sourceProviderReference,
      currency: plan.currency,
      amountMinor: plan.amountMinor,
    } });
    return {
      refund,
      callProvider: true,
      sourceProviderReference: plan.sourceProviderReference,
      amountMinor: plan.amountMinor,
      fingerprint,
      nextPaymentStatus: plan.nextPaymentStatus,
    } as const;
  }, { isolationLevel: 'Serializable' });

  if (!claim.callProvider) return claim.refund;

  let result: ProviderRefundResult;
  try {
    result = await stripe.provider.refundPayment({
      organizationId: input.organizationId,
      bookingId: booking.id,
      idempotencyKey,
      money: { currency: booking.currency, amountMinor: claim.amountMinor },
      providerReference: claim.sourceProviderReference,
    });
  } catch (error) {
    if (error instanceof PaymentProviderError && !error.retryable) {
      await failInternalClaim({ organizationId: input.organizationId, actorUserId: input.actorUserId, bookingId: booking.id, refundId: claim.refund.id });
    }
    throw error;
  }

  if (
    result.providerCode !== PROVIDER
    || result.providerReference !== claim.sourceProviderReference
    || result.money.currency !== booking.currency
    || result.money.amountMinor !== claim.amountMinor
  ) throw new PaymentConflictError('Stripe returned a refund result that does not match the requested refund.');
  if (!REFUND_REFERENCE.test(result.refundReference)) throw new PaymentConflictError('Stripe returned an invalid refund reference.');
  const transactionStatus = stripeRefundPersistenceStatus(result.status);

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({ organizationId: input.organizationId, bookingId: booking.id })}, 0))`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.organizationId, 'booking', booking.id)}, 0))`;

    const existing = await tx.paymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
    });
    if (!existing) throw new PaymentConflictError('Stripe refund claim disappeared before persistence.');
    assertExisting(existing, {
      bookingId: booking.id,
      currency: booking.currency,
      amountMinor: claim.amountMinor,
      fingerprint: claim.fingerprint,
      sourceProviderReference: claim.sourceProviderReference,
    });
    if (existing.providerReference !== paymentOperationClaimReference(claim.fingerprint)) return existing;

    if (await tx.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        providerCode: PROVIDER,
        providerReference: result.refundReference,
        id: { not: existing.id },
      },
      select: { id: true },
    })) throw new PaymentConflictError('Stripe refund reference has already been recorded in this organization.');

    const currentBooking = await tx.hospitalityBooking.findFirst({
      where: { id: booking.id, organizationId: input.organizationId },
      select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true },
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
      const ledger = await tx.paymentTransaction.findMany({
        where: { organizationId: input.organizationId, bookingId: booking.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      bookingPaymentStatus = requireReconciledBookingPaymentStatus({
        bookingTotalMinor: currentBooking.totalMinor,
        currency: currentBooking.currency,
        transactions: ledger,
      });
      if (bookingPaymentStatus !== claim.nextPaymentStatus) {
        throw new PaymentConflictError('Stripe refund result no longer matches the authoritative booking settlement state.');
      }
      if (currentBooking.paymentStatus !== bookingPaymentStatus) {
        await tx.hospitalityBooking.update({ where: { id: booking.id }, data: { paymentStatus: bookingPaymentStatus } });
      }
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
        sourceProviderReference: refund.sourceProviderReference,
        currency: refund.currency,
        amountMinor: refund.amountMinor.toString(),
        bookingPaymentStatus,
      },
    } });
    return refund;
  }, { isolationLevel: 'Serializable' });
}
