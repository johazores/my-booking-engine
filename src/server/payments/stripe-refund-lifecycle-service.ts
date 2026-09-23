import { createHash } from 'node:crypto';

import { hospitalityBookingMutationLockKey } from '../bookings/hospitality-booking-mutation-lock.ts';
import { db } from '../database.ts';
import { loadStripePaymentIntegration } from '../integrations/stripe-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveBookingRefundExecutionPlan } from './payment-refund-execution-domain.ts';
import { deriveBookingPaymentStatusFromSettlementTransactions } from './payment-refund-state-domain.ts';
import { PaymentConflictError } from './payment-service.ts';
import {
  bookingPaymentStatusForRefundLifecycle,
  decideStripeRefundLifecycleMutation,
} from './stripe-refund-lifecycle-domain.ts';
import { reconcileStripeRefundState } from './stripe-refund-reconciliation-service.ts';
import {
  StripeWebhookValidationError,
  parseStripeWebhookEventPayload,
} from './stripe-webhook-domain.ts';

const STRIPE_PROVIDER_CODE = 'stripe';

function paymentLockKey(organizationId: string, bookingId: string) {
  return `payment:${organizationId}:booking:${bookingId}`;
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
  if (!result.reconciled) throw new PaymentConflictError(result.reason);
  return result.paymentStatus;
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
  if (plan.providerCode !== STRIPE_PROVIDER_CODE) {
    throw new PaymentConflictError('Stripe refund no longer matches a Stripe settlement source.');
  }
  return plan;
}

export async function reconcileVerifiedStripeRefundWebhook(input: {
  organizationId: string;
  verifiedWebhookEventId: string;
  payload: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.verifiedWebhookEventId, 'verifiedWebhookEventId');

  let event;
  try {
    event = parseStripeWebhookEventPayload(input.payload);
  } catch (error) {
    if (error instanceof StripeWebhookValidationError) throw new PaymentConflictError(error.message);
    throw error;
  }
  if (!event.refund) return Object.freeze({ handled: false as const });

  const payloadHash = createHash('sha256').update(input.payload, 'utf8').digest('hex');
  const verifiedEvent = await db.paymentWebhookEvent.findFirst({
    where: {
      id: input.verifiedWebhookEventId,
      organizationId: input.organizationId,
      providerCode: STRIPE_PROVIDER_CODE,
      providerEventId: event.providerEventId,
    },
    select: {
      id: true,
      eventType: true,
      payloadHash: true,
      providerReference: true,
    },
  });
  if (
    !verifiedEvent
    || verifiedEvent.eventType !== event.eventType
    || verifiedEvent.payloadHash !== payloadHash
    || verifiedEvent.providerReference !== event.refund.refundReference
  ) {
    throw new PaymentConflictError('Stripe refund lifecycle event is not backed by the verified webhook ledger.');
  }

  const exactRefunds = await db.paymentTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      providerCode: STRIPE_PROVIDER_CODE,
      kind: 'REFUND',
      commercialAmendmentId: null,
      providerReference: event.refund.refundReference,
    },
    select: {
      id: true,
      bookingId: true,
      status: true,
      providerReference: true,
      sourceProviderReference: true,
      currency: true,
      amountMinor: true,
    },
    take: 2,
  });
  if (exactRefunds.length === 0) return Object.freeze({ handled: false as const });
  if (exactRefunds.length > 1) throw new PaymentConflictError('Stripe refund reference belongs to multiple normal refund transactions.');

  const refund = exactRefunds[0]!;
  if (
    refund.sourceProviderReference !== event.refund.paymentIntentReference
    || refund.currency !== event.refund.currency
    || refund.amountMinor !== event.refund.amountMinor
  ) {
    throw new PaymentConflictError('Verified Stripe refund event does not match the persisted refund identity and money.');
  }
  if (!refund.sourceProviderReference) throw new PaymentConflictError('Stripe refund is missing its settlement-source reference.');

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  if (!stripe.integration.capabilities.includes('payment-refund')) {
    throw new PaymentConflictError('Stripe integration is not configured for payment-refund.');
  }
  const snapshot = await stripe.refundReconciliationProvider.retrieveRefund(refund.providerReference);
  if (snapshot.refundReference !== refund.providerReference) {
    throw new PaymentConflictError('Stripe refund retrieval returned a different refund reference.');
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
    if (!current) throw new PaymentConflictError('Stripe refund is no longer available for lifecycle reconciliation.');
    if (
      current.providerReference !== refund.providerReference
      || current.sourceProviderReference !== refund.sourceProviderReference
      || current.currency !== refund.currency
      || current.amountMinor !== refund.amountMinor
    ) {
      throw new PaymentConflictError('Stripe refund identity changed during lifecycle reconciliation.');
    }

    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: refund.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!booking || booking.status !== 'CONFIRMED') {
      throw new PaymentConflictError('Booking no longer accepts Stripe refund lifecycle reconciliation.');
    }
    if (booking.currency !== current.currency || current.amountMinor <= 0n) {
      throw new PaymentConflictError('Stripe refund money is invalid for the authoritative booking.');
    }

    const ledger = await transaction.paymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: booking.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const baselineTransactions = ledger.filter((entry) => entry.id !== current.id);
    const baselinePaymentStatus = requireReconciledBookingPaymentStatus({
      bookingTotalMinor: booking.totalMinor,
      currency: booking.currency,
      transactions: baselineTransactions,
    });
    const plan = requireStripeRefundPlan({
      bookingPaymentStatus: baselinePaymentStatus,
      bookingTotalMinor: booking.totalMinor,
      currency: booking.currency,
      transactions: baselineTransactions,
      requestedAmountMinor: current.amountMinor,
    });
    if (
      plan.sourceProviderReference !== current.sourceProviderReference
      || plan.currency !== current.currency
      || plan.amountMinor !== current.amountMinor
    ) {
      throw new PaymentConflictError('Stripe refund no longer matches the authoritative settlement allocation.');
    }

    const expectedCurrentBookingStatus = bookingPaymentStatusForRefundLifecycle({
      refundStatus: current.status,
      baselinePaymentStatus,
      successfulRefundPaymentStatus: plan.nextPaymentStatus,
    });
    if (booking.paymentStatus !== expectedCurrentBookingStatus) {
      throw new PaymentConflictError('Booking payment state is inconsistent with the persisted Stripe refund lifecycle.');
    }

    const decision = decideStripeRefundLifecycleMutation({
      currentStatus: current.status,
      providerStatus,
    });
    const nextRefundStatus = decision.nextStatus;
    const nextBookingPaymentStatus = bookingPaymentStatusForRefundLifecycle({
      refundStatus: nextRefundStatus,
      baselinePaymentStatus,
      successfulRefundPaymentStatus: plan.nextPaymentStatus,
    });

    if (decision.action === 'MUTATE') {
      await transaction.paymentTransaction.update({
        where: {
          id: current.id,
          organizationId: input.organizationId,
          bookingId: booking.id,
          commercialAmendmentId: null,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: 'REFUND',
          status: current.status,
          providerReference: current.providerReference,
          sourceProviderReference: current.sourceProviderReference,
          currency: current.currency,
          amountMinor: current.amountMinor,
        },
        data: { status: nextRefundStatus },
      });
      if (booking.paymentStatus !== nextBookingPaymentStatus) {
        await transaction.hospitalityBooking.update({
          where: {
            id: booking.id,
            organizationId: input.organizationId,
            status: 'CONFIRMED',
            paymentStatus: booking.paymentStatus,
            currency: booking.currency,
            totalMinor: booking.totalMinor,
          },
          data: { paymentStatus: nextBookingPaymentStatus },
        });
      }
    }

    await transaction.paymentWebhookEvent.update({
      where: {
        id: verifiedEvent.id,
        organizationId: input.organizationId,
        providerCode: STRIPE_PROVIDER_CODE,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        payloadHash,
      },
      data: {
        bookingId: booking.id,
        providerReference: current.providerReference,
        status: 'PROCESSED',
        processingNote: decision.processingNote,
        processedAt: new Date(),
      },
    });

    return Object.freeze({
      handled: true as const,
      changed: decision.action === 'MUTATE',
      transactionStatus: nextRefundStatus,
      bookingPaymentStatus: nextBookingPaymentStatus,
      providerStatus: snapshot.status,
    });
  }, { isolationLevel: 'Serializable' });
}
