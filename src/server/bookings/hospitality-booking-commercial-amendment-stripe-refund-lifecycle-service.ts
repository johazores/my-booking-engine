import { createHash } from 'node:crypto';

import { db } from '../database.ts';
import { loadStripePaymentIntegration } from '../integrations/stripe-integration.ts';
import { PaymentConflictError } from '../payments/payment-service.ts';
import {
  StripeWebhookValidationError,
  parseStripeWebhookEventPayload,
} from '../payments/stripe-webhook-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  decideStripeCommercialAmendmentRefundLifecycleMutation,
  reconcileStripeCommercialAmendmentRefundSnapshot,
  stripeCommercialAmendmentRefundFingerprint,
} from './booking-commercial-amendment-stripe-refund-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';

const STRIPE_PROVIDER_CODE = 'stripe';

function paymentLockKey(organizationId: string, bookingId: string) {
  return `payment:${organizationId}:booking:${bookingId}`;
}

function assertCommercialAmendmentRefundAuthority(input: {
  amendment: {
    direction: string;
    paymentProviderCode: string;
    currency: string;
    beforeTotalMinor: bigint;
    afterTotalMinor: bigint;
    deltaMinor: bigint;
  };
  refund: {
    currency: string;
    amountMinor: bigint;
    sourceProviderReference: string | null;
  };
}) {
  const requiredRefundMinor = input.amendment.beforeTotalMinor - input.amendment.afterTotalMinor;
  if (
    input.amendment.direction !== 'REFUND'
    || input.amendment.paymentProviderCode !== STRIPE_PROVIDER_CODE
    || input.amendment.currency !== input.refund.currency
    || input.amendment.deltaMinor >= 0n
    || requiredRefundMinor !== -input.amendment.deltaMinor
    || input.refund.amountMinor <= 0n
    || input.refund.amountMinor > requiredRefundMinor
    || !input.refund.sourceProviderReference
  ) {
    throw new PaymentConflictError('Commercial amendment no longer matches the Stripe refund lifecycle evidence.');
  }
}

export async function reconcileVerifiedStripeCommercialAmendmentRefundWebhook(input: {
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
      status: true,
      processingNote: true,
    },
  });
  if (
    !verifiedEvent
    || verifiedEvent.eventType !== event.eventType
    || verifiedEvent.payloadHash !== payloadHash
    || verifiedEvent.providerReference !== event.refund.refundReference
  ) {
    throw new PaymentConflictError('Stripe commercial amendment refund lifecycle event is not backed by the verified webhook ledger.');
  }
  if (
    verifiedEvent.status === 'PROCESSED'
    && verifiedEvent.processingNote.startsWith('commercial-amendment-refund-lifecycle-')
  ) {
    return Object.freeze({ handled: true as const, idempotent: true as const });
  }

  const exactRefunds = await db.paymentTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      providerCode: STRIPE_PROVIDER_CODE,
      kind: 'REFUND',
      commercialAmendmentId: { not: null },
      providerReference: event.refund.refundReference,
    },
    select: {
      id: true,
      bookingId: true,
      commercialAmendmentId: true,
      status: true,
      providerReference: true,
      sourceProviderReference: true,
      requestFingerprint: true,
      currency: true,
      amountMinor: true,
    },
    take: 2,
  });
  if (exactRefunds.length === 0) return Object.freeze({ handled: false as const });
  if (exactRefunds.length > 1) {
    throw new PaymentConflictError('Stripe refund reference belongs to multiple commercial amendment refund transactions.');
  }

  const refund = exactRefunds[0]!;
  if (!refund.commercialAmendmentId || !refund.sourceProviderReference) {
    throw new PaymentConflictError('Commercial amendment Stripe refund is missing persisted ownership or settlement-source authority.');
  }
  if (
    refund.sourceProviderReference !== event.refund.paymentIntentReference
    || refund.currency !== event.refund.currency
    || refund.amountMinor !== event.refund.amountMinor
  ) {
    throw new PaymentConflictError('Verified Stripe refund event does not match the persisted commercial amendment refund identity and money.');
  }
  const expectedFingerprint = stripeCommercialAmendmentRefundFingerprint({
    bookingId: refund.bookingId,
    amendmentId: refund.commercialAmendmentId,
    currency: refund.currency,
    amountMinor: refund.amountMinor,
    sourceProviderReference: refund.sourceProviderReference,
  });
  if (refund.requestFingerprint !== expectedFingerprint) {
    throw new PaymentConflictError('Commercial amendment Stripe refund fingerprint is inconsistent.');
  }

  const amendment = await db.hospitalityBookingCommercialAmendment.findFirst({
    where: {
      id: refund.commercialAmendmentId,
      organizationId: input.organizationId,
      bookingId: refund.bookingId,
    },
    select: {
      id: true,
      status: true,
      direction: true,
      paymentProviderCode: true,
      currency: true,
      beforeTotalMinor: true,
      afterTotalMinor: true,
      deltaMinor: true,
    },
  });
  if (!amendment) throw new PaymentConflictError('Commercial amendment is unavailable for Stripe refund lifecycle reconciliation.');
  if (amendment.direction !== 'REFUND') {
    return Object.freeze({ handled: false as const });
  }
  assertCommercialAmendmentRefundAuthority({ amendment, refund });

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  if (!stripe.integration.capabilities.includes('payment-refund')) {
    throw new PaymentConflictError('Stripe integration is not configured for payment-refund.');
  }
  const snapshot = await stripe.refundReconciliationProvider.retrieveRefund(refund.providerReference);
  if (snapshot.refundReference !== refund.providerReference) {
    throw new PaymentConflictError('Stripe refund retrieval returned a different commercial amendment refund reference.');
  }

  let providerStatus: 'AMBIGUOUS' | 'SUCCEEDED' | 'FAILED';
  try {
    providerStatus = reconcileStripeCommercialAmendmentRefundSnapshot({
      currency: refund.currency,
      amountMinor: refund.amountMinor,
      sourceProviderReference: refund.sourceProviderReference,
      snapshot,
    });
  } catch (error) {
    throw new PaymentConflictError(
      error instanceof Error ? error.message : 'Stripe commercial amendment refund provider truth is invalid.',
    );
  }

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: refund.bookingId,
    })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, refund.bookingId)}, 0))`;

    const current = await transaction.paymentTransaction.findFirst({
      where: {
        id: refund.id,
        organizationId: input.organizationId,
        bookingId: refund.bookingId,
        commercialAmendmentId: refund.commercialAmendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'REFUND',
      },
    });
    if (!current) throw new PaymentConflictError('Commercial amendment Stripe refund is no longer available for lifecycle reconciliation.');
    if (
      current.providerReference !== refund.providerReference
      || current.sourceProviderReference !== refund.sourceProviderReference
      || current.requestFingerprint !== refund.requestFingerprint
      || current.currency !== refund.currency
      || current.amountMinor !== refund.amountMinor
    ) {
      throw new PaymentConflictError('Commercial amendment Stripe refund identity changed during lifecycle reconciliation.');
    }

    const currentAmendment = await transaction.hospitalityBookingCommercialAmendment.findFirst({
      where: {
        id: refund.commercialAmendmentId,
        organizationId: input.organizationId,
        bookingId: refund.bookingId,
      },
      select: {
        id: true,
        status: true,
        direction: true,
        paymentProviderCode: true,
        currency: true,
        beforeTotalMinor: true,
        afterTotalMinor: true,
        deltaMinor: true,
      },
    });
    if (!currentAmendment) throw new PaymentConflictError('Commercial amendment is no longer available for Stripe refund lifecycle reconciliation.');
    if (
      currentAmendment.direction !== amendment.direction
      || currentAmendment.paymentProviderCode !== amendment.paymentProviderCode
      || currentAmendment.currency !== amendment.currency
      || currentAmendment.beforeTotalMinor !== amendment.beforeTotalMinor
      || currentAmendment.afterTotalMinor !== amendment.afterTotalMinor
      || currentAmendment.deltaMinor !== amendment.deltaMinor
    ) {
      throw new PaymentConflictError('Commercial amendment authority changed during Stripe refund lifecycle reconciliation.');
    }
    assertCommercialAmendmentRefundAuthority({ amendment: currentAmendment, refund: current });

    const duplicateReference = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: current.providerReference,
        id: { not: current.id },
      },
      select: { id: true },
    });
    if (duplicateReference) {
      throw new PaymentConflictError('Stripe refund reference is already recorded by another payment transaction.');
    }

    const decision = decideStripeCommercialAmendmentRefundLifecycleMutation({
      currentStatus: current.status,
      providerStatus,
    });
    if (decision.action === 'MUTATE') {
      await transaction.paymentTransaction.update({
        where: {
          id: current.id,
          organizationId: input.organizationId,
          bookingId: refund.bookingId,
          commercialAmendmentId: refund.commercialAmendmentId,
          idempotencyKey: current.idempotencyKey,
          requestFingerprint: current.requestFingerprint,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: 'REFUND',
          status: current.status,
          providerReference: current.providerReference,
          sourceProviderReference: current.sourceProviderReference,
          currency: current.currency,
          amountMinor: current.amountMinor,
        },
        data: { status: decision.nextStatus },
      });
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
        bookingId: refund.bookingId,
        providerReference: current.providerReference,
        status: 'PROCESSED',
        processingNote: decision.processingNote,
        processedAt: new Date(),
      },
    });

    return Object.freeze({
      handled: true as const,
      idempotent: false as const,
      changed: decision.action === 'MUTATE',
      transactionStatus: decision.nextStatus,
      providerStatus: snapshot.status,
      amendmentStatus: currentAmendment.status,
    });
  }, { isolationLevel: 'Serializable' });
}
