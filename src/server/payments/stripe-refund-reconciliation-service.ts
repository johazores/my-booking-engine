import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { hospitalityBookingMutationLockKey } from '../bookings/hospitality-booking-mutation-lock.ts';
import { db } from '../database.ts';
import { loadStripePaymentIntegration } from '../integrations/stripe-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveBookingRefundExecutionPlan } from './payment-refund-execution-domain.ts';
import { deriveBookingPaymentStatusFromSettlementTransactions } from './payment-refund-state-domain.ts';
import { PaymentConflictError, PaymentUnavailableError } from './payment-service.ts';
import {
  bookingPaymentStatusForRefundLifecycle,
  decideStripeRefundLifecycleMutation,
} from './stripe-refund-lifecycle-domain.ts';
import { isInternalPaymentClaimReference } from './stripe-payment-service.ts';
import type { StripeRefundSnapshot } from './stripe-refund-reconciliation-provider.ts';

const STRIPE_PROVIDER_CODE = 'stripe';

function paymentLockKey(organizationId: string, bookingId: string) {
  return `payment:${organizationId}:booking:${bookingId}`;
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
  requestedAmountMinor: bigint;
}) {
  const plan = deriveBookingRefundExecutionPlan({
    ...input,
    expectedProviderCode: STRIPE_PROVIDER_CODE,
  });
  if (!plan.planned) throw new PaymentConflictError(plan.reason);
  if (plan.providerCode !== STRIPE_PROVIDER_CODE) throw new PaymentConflictError('Stripe refund settlement source is not available for reconciliation.');
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

export function reconcileStripeRefundState(input: {
  currency: string;
  amountMinor: bigint;
  sourceProviderReference: string;
  snapshot: StripeRefundSnapshot;
}): 'PENDING' | 'SUCCEEDED' | 'FAILED' {
  if (
    input.snapshot.currency !== input.currency
    || input.snapshot.amountMinor !== input.amountMinor
    || input.snapshot.paymentIntentReference !== input.sourceProviderReference
  ) {
    throw new PaymentConflictError('Stripe refund reconciliation result does not match the persisted refund.');
  }
  if (input.snapshot.status === 'succeeded') return 'SUCCEEDED';
  if (input.snapshot.status === 'failed' || input.snapshot.status === 'canceled') return 'FAILED';
  return 'PENDING';
}

export async function reconcileStripeRefundTransaction(input: {
  organizationId: string;
  actorUserId: string;
  transactionId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.transactionId, 'transactionId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' });

  const refund = await db.paymentTransaction.findFirst({
    where: { id: input.transactionId, organizationId: input.organizationId, providerCode: STRIPE_PROVIDER_CODE },
  });
  if (!refund) throw new PaymentUnavailableError('Stripe refund transaction is not available in this organization.');
  if (refund.kind !== 'REFUND') throw new PaymentConflictError('Only Stripe refund transactions can be reconciled by this boundary.');
  if (refund.commercialAmendmentId !== null) {
    throw new PaymentConflictError('Commercial amendment Stripe refunds must use the commercial amendment recovery boundary.');
  }
  if (isInternalPaymentClaimReference(refund.providerReference)) {
    throw new PaymentConflictError('Stripe refund claim has no refund reference yet; use the exact retry or a verified refund webhook to resolve it.');
  }
  if (!refund.sourceProviderReference || isInternalPaymentClaimReference(refund.sourceProviderReference)) {
    throw new PaymentConflictError('Stripe refund is missing its authoritative settlement-source reference.');
  }

  const [booking, ledger] = await Promise.all([
    db.hospitalityBooking.findFirst({
      where: { id: refund.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true },
    }),
    db.paymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: refund.bookingId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  if (!booking) throw new PaymentUnavailableError('Booking is not available in this organization.');
  if (booking.status !== 'CONFIRMED') throw new PaymentConflictError('Only confirmed bookings can reconcile Stripe refunds.');
  if (refund.currency !== booking.currency || refund.amountMinor <= 0n) {
    throw new PaymentConflictError('Persisted Stripe refund money is invalid for this booking.');
  }

  const baselineTransactions = ledger.filter((transaction) => transaction.id !== refund.id);
  const baselinePaymentStatus = requireReconciledBookingPaymentStatus({
    bookingTotalMinor: booking.totalMinor,
    currency: booking.currency,
    transactions: baselineTransactions,
  });
  const initialPlan = requireStripeRefundPlan({
    bookingPaymentStatus: baselinePaymentStatus,
    bookingTotalMinor: booking.totalMinor,
    currency: booking.currency,
    transactions: baselineTransactions,
    requestedAmountMinor: refund.amountMinor,
  });
  if (
    initialPlan.sourceProviderReference !== refund.sourceProviderReference
    || initialPlan.amountMinor !== refund.amountMinor
    || initialPlan.currency !== refund.currency
  ) throw new PaymentConflictError('Persisted Stripe refund no longer matches the authoritative settlement allocation.');

  const expectedBookingPaymentStatus = bookingPaymentStatusForRefundLifecycle({
    refundStatus: refund.status,
    baselinePaymentStatus,
    successfulRefundPaymentStatus: initialPlan.nextPaymentStatus,
  });
  if (booking.paymentStatus !== expectedBookingPaymentStatus) {
    throw new PaymentConflictError('Booking payment state is inconsistent with the persisted Stripe refund lifecycle.');
  }

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  if (!stripe.integration.capabilities.includes('payment-refund')) {
    throw new PaymentConflictError('Stripe integration is not configured for payment-refund.');
  }

  const snapshot = await stripe.refundReconciliationProvider.retrieveRefund(refund.providerReference);
  if (snapshot.refundReference !== refund.providerReference) {
    throw new PaymentConflictError('Stripe refund reconciliation returned a different refund reference.');
  }
  const providerStatus = reconcileStripeRefundState({
    currency: refund.currency,
    amountMinor: refund.amountMinor,
    sourceProviderReference: refund.sourceProviderReference,
    snapshot,
  });

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({ organizationId: input.organizationId, bookingId: refund.bookingId })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, refund.bookingId)}, 0))`;

    const current = await transaction.paymentTransaction.findFirst({
      where: {
        id: refund.id,
        organizationId: input.organizationId,
        bookingId: refund.bookingId,
        commercialAmendmentId: null,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'REFUND',
      },
    });
    if (!current) throw new PaymentUnavailableError('Stripe refund transaction is not available in this organization.');
    if (
      current.providerReference !== refund.providerReference
      || current.sourceProviderReference !== refund.sourceProviderReference
      || current.currency !== refund.currency
      || current.amountMinor !== refund.amountMinor
    ) throw new PaymentConflictError('Stripe refund transaction changed during reconciliation.');

    const currentBooking = await transaction.hospitalityBooking.findFirst({
      where: { id: refund.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!currentBooking || currentBooking.status !== 'CONFIRMED') {
      throw new PaymentConflictError('Booking no longer accepts Stripe refund reconciliation.');
    }
    if (currentBooking.currency !== booking.currency || currentBooking.totalMinor !== booking.totalMinor) {
      throw new PaymentConflictError('Booking money changed during Stripe refund reconciliation.');
    }

    const currentLedger = await transaction.paymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: refund.bookingId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const currentBaselineTransactions = currentLedger.filter((entry) => entry.id !== current.id);
    const currentBaselinePaymentStatus = requireReconciledBookingPaymentStatus({
      bookingTotalMinor: currentBooking.totalMinor,
      currency: currentBooking.currency,
      transactions: currentBaselineTransactions,
    });
    const currentPlan = requireStripeRefundPlan({
      bookingPaymentStatus: currentBaselinePaymentStatus,
      bookingTotalMinor: currentBooking.totalMinor,
      currency: currentBooking.currency,
      transactions: currentBaselineTransactions,
      requestedAmountMinor: current.amountMinor,
    });
    if (
      currentPlan.sourceProviderReference !== current.sourceProviderReference
      || currentPlan.amountMinor !== current.amountMinor
      || currentPlan.currency !== current.currency
    ) throw new PaymentConflictError('Stripe refund settlement allocation changed during reconciliation.');

    const currentExpectedBookingPaymentStatus = bookingPaymentStatusForRefundLifecycle({
      refundStatus: current.status,
      baselinePaymentStatus: currentBaselinePaymentStatus,
      successfulRefundPaymentStatus: currentPlan.nextPaymentStatus,
    });
    if (currentBooking.paymentStatus !== currentExpectedBookingPaymentStatus) {
      throw new PaymentConflictError('Booking payment state changed inconsistently during Stripe refund reconciliation.');
    }

    const decision = decideStripeRefundLifecycleMutation({
      currentStatus: current.status,
      providerStatus,
    });
    if (decision.action === 'KEEP') return current;

    const updated = await transaction.paymentTransaction.update({
      where: {
        id: current.id,
        organizationId: input.organizationId,
        bookingId: refund.bookingId,
        commercialAmendmentId: null,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'REFUND',
        status: current.status,
        providerReference: refund.providerReference,
        sourceProviderReference: refund.sourceProviderReference,
        currency: refund.currency,
        amountMinor: refund.amountMinor,
      },
      data: { status: decision.nextStatus },
    });

    const bookingPaymentStatus = bookingPaymentStatusForRefundLifecycle({
      refundStatus: decision.nextStatus,
      baselinePaymentStatus: currentBaselinePaymentStatus,
      successfulRefundPaymentStatus: currentPlan.nextPaymentStatus,
    });
    if (currentBooking.paymentStatus !== bookingPaymentStatus) {
      await transaction.hospitalityBooking.update({
        where: {
          id: currentBooking.id,
          organizationId: input.organizationId,
          status: 'CONFIRMED',
          paymentStatus: currentBooking.paymentStatus,
          currency: currentBooking.currency,
          totalMinor: currentBooking.totalMinor,
        },
        data: { paymentStatus: bookingPaymentStatus },
      });
    }

    await transaction.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'payment.stripe-refund-reconciled',
      resourceType: 'payment-transaction',
      resourceId: updated.id,
      afterData: {
        bookingId: currentBooking.id,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'REFUND',
        previousStatus: current.status,
        status: updated.status,
        bookingPaymentStatus,
        providerStatus: snapshot.status,
        sourceProviderReference: updated.sourceProviderReference,
        currency: updated.currency,
        amountMinor: updated.amountMinor.toString(),
      },
    } });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
