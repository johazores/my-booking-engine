import { createHash } from 'node:crypto';

import type { Prisma } from '../../generated/prisma/client.ts';
import { db } from '../database.ts';
import { PaymentConflictError } from '../payments/payment-service.ts';
import {
  StripeWebhookValidationError,
  parseStripeWebhookEventPayload,
  type StripeWebhookEvent,
} from '../payments/stripe-webhook-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  StripeCommercialAmendmentWebhookConflictError,
  selectStripeCommercialAmendmentPaymentWebhookCandidate,
  selectStripeCommercialAmendmentRefundWebhookCandidate,
} from './booking-commercial-amendment-stripe-webhook-domain.ts';
import {
  reconcileStripeCommercialAmendmentChargeSnapshot,
  stripeCommercialAmendmentChargeFingerprint,
  stripeCommercialAmendmentDirectCaptureIdempotencyKey,
} from './booking-commercial-amendment-stripe-charge-domain.ts';
import {
  reconcileStripeCommercialAmendmentRefundSnapshot,
  stripeCommercialAmendmentRefundFingerprint,
} from './booking-commercial-amendment-stripe-refund-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';

const STRIPE_PROVIDER_CODE = 'stripe';

function paymentLockKey(organizationId: string, bookingId: string) {
  return `payment:${organizationId}:booking:${bookingId}`;
}

function webhookLockKey(organizationId: string, providerEventId: string) {
  return `payment:${organizationId}:webhook:${providerEventId}`;
}

function parseCapturableMinor(input: {
  payload: string;
  providerReference: string;
  providerStatus: string;
  amountMinor: bigint;
}) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.payload);
  } catch {
    throw new PaymentConflictError('Verified Stripe webhook payload is no longer valid JSON.');
  }
  const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as { data?: unknown }).data
    : null;
  const object = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as { object?: unknown }).object
    : null;
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    throw new PaymentConflictError('Verified Stripe PaymentIntent payload is invalid.');
  }
  const record = object as Record<string, unknown>;
  if (record.id !== input.providerReference) {
    throw new PaymentConflictError('Verified Stripe PaymentIntent identity changed during amendment finalization.');
  }
  const value = record.amount_capturable ?? 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new PaymentConflictError('Verified Stripe PaymentIntent capturable amount is invalid.');
  }
  const amountCapturableMinor = BigInt(Number(value));
  if (amountCapturableMinor > input.amountMinor) {
    throw new PaymentConflictError('Verified Stripe PaymentIntent capturable amount exceeds the payment amount.');
  }
  if (input.providerStatus === 'requires_capture' && amountCapturableMinor === 0n) {
    throw new PaymentConflictError('Verified Stripe PaymentIntent is missing its capturable amount.');
  }
  return amountCapturableMinor;
}

async function persistDirectCapture(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  amendmentId: string;
  currency: string;
  amountMinor: bigint;
  providerReference: string;
}) {
  const idempotencyKey = stripeCommercialAmendmentDirectCaptureIdempotencyKey(input);
  const requestFingerprint = stripeCommercialAmendmentChargeFingerprint({
    bookingId: input.bookingId,
    amendmentId: input.amendmentId,
    stage: 'CAPTURE',
    currency: input.currency,
    amountMinor: input.amountMinor,
    providerReference: input.providerReference,
  });
  const existing = await input.transaction.paymentTransaction.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
  });
  if (existing) {
    if (
      existing.bookingId !== input.bookingId
      || existing.commercialAmendmentId !== input.amendmentId
      || existing.kind !== 'CAPTURE'
      || existing.status !== 'SUCCEEDED'
      || existing.providerCode !== STRIPE_PROVIDER_CODE
      || existing.providerReference !== input.providerReference
      || existing.currency !== input.currency
      || existing.amountMinor !== input.amountMinor
      || existing.requestFingerprint !== requestFingerprint
    ) {
      throw new PaymentConflictError('Commercial amendment direct Stripe settlement evidence is inconsistent.');
    }
    return existing;
  }
  return input.transaction.paymentTransaction.create({ data: {
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    commercialAmendmentId: input.amendmentId,
    idempotencyKey,
    requestFingerprint,
    kind: 'CAPTURE',
    status: 'SUCCEEDED',
    providerCode: STRIPE_PROVIDER_CODE,
    providerReference: input.providerReference,
    currency: input.currency,
    amountMinor: input.amountMinor,
  } });
}

function assertChargeAmendment(input: {
  amendment: {
    status: string;
    direction: string;
    paymentProviderCode: string;
    currency: string;
    beforeTotalMinor: bigint;
    afterTotalMinor: bigint;
    deltaMinor: bigint;
  };
  payment: { currency: string; amountMinor: bigint };
}) {
  if (
    input.amendment.status !== 'PREPARED'
    || input.amendment.direction !== 'ADDITIONAL_CHARGE'
    || input.amendment.paymentProviderCode !== STRIPE_PROVIDER_CODE
    || input.amendment.currency !== input.payment.currency
    || input.amendment.deltaMinor <= 0n
    || input.amendment.afterTotalMinor - input.amendment.beforeTotalMinor !== input.amendment.deltaMinor
    || input.payment.amountMinor <= 0n
    || input.payment.amountMinor > input.amendment.deltaMinor
  ) {
    throw new PaymentConflictError('Commercial amendment no longer matches the Stripe charge webhook evidence.');
  }
}

function assertRefundAmendment(input: {
  amendment: {
    status: string;
    direction: string;
    paymentProviderCode: string;
    currency: string;
    beforeTotalMinor: bigint;
    afterTotalMinor: bigint;
    deltaMinor: bigint;
  };
  refund: { sourceProviderReference: string | null; currency: string; amountMinor: bigint };
}) {
  const requiredRefundMinor = input.amendment.beforeTotalMinor - input.amendment.afterTotalMinor;
  if (
    input.amendment.status !== 'PREPARED'
    || input.amendment.direction !== 'REFUND'
    || input.amendment.paymentProviderCode !== STRIPE_PROVIDER_CODE
    || input.amendment.currency !== input.refund.currency
    || input.amendment.deltaMinor >= 0n
    || requiredRefundMinor !== -input.amendment.deltaMinor
    || input.refund.amountMinor <= 0n
    || input.refund.amountMinor > requiredRefundMinor
    || !input.refund.sourceProviderReference
  ) {
    throw new PaymentConflictError('Commercial amendment no longer matches the Stripe refund webhook evidence.');
  }
}

async function finalizeCharge(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  payload: string;
  event: StripeWebhookEvent;
  verifiedWebhookEventId: string;
}) {
  const intent = input.event.paymentIntent!;
  if (!intent.organizationId || !intent.bookingId || intent.organizationId !== input.organizationId) return false;

  const candidates = await input.transaction.paymentTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: intent.bookingId,
      providerCode: STRIPE_PROVIDER_CODE,
      commercialAmendmentId: { not: null },
      kind: { in: ['AUTHORIZATION', 'CAPTURE'] },
      status: 'AMBIGUOUS',
      providerReference: intent.providerReference,
    },
    select: {
      id: true,
      bookingId: true,
      commercialAmendmentId: true,
      kind: true,
      providerReference: true,
      currency: true,
      amountMinor: true,
    },
    take: 8,
  });
  const selected = selectStripeCommercialAmendmentPaymentWebhookCandidate({
    providerReference: intent.providerReference,
    currency: intent.currency,
    amountMinor: intent.amountMinor,
    candidates: candidates.flatMap((candidate) => candidate.commercialAmendmentId && (candidate.kind === 'AUTHORIZATION' || candidate.kind === 'CAPTURE')
      ? [{ ...candidate, commercialAmendmentId: candidate.commercialAmendmentId, kind: candidate.kind }]
      : []),
  });
  if (!selected) return false;

  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({ organizationId: input.organizationId, bookingId: selected.bookingId })}, 0))`;
  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, selected.bookingId)}, 0))`;

  const payment = await input.transaction.paymentTransaction.findFirst({
    where: {
      id: selected.id,
      organizationId: input.organizationId,
      bookingId: selected.bookingId,
      commercialAmendmentId: selected.commercialAmendmentId,
      providerCode: STRIPE_PROVIDER_CODE,
      kind: selected.kind,
      status: 'AMBIGUOUS',
      providerReference: intent.providerReference,
    },
  });
  if (!payment) throw new PaymentConflictError('Commercial amendment Stripe charge changed during webhook finalization.');

  const amendment = await input.transaction.hospitalityBookingCommercialAmendment.findFirst({
    where: { id: selected.commercialAmendmentId, organizationId: input.organizationId, bookingId: selected.bookingId },
    select: {
      status: true,
      direction: true,
      paymentProviderCode: true,
      currency: true,
      beforeTotalMinor: true,
      afterTotalMinor: true,
      deltaMinor: true,
    },
  });
  if (!amendment) throw new PaymentConflictError('Commercial amendment is unavailable during Stripe webhook finalization.');
  assertChargeAmendment({ amendment, payment });

  const reconciliation = reconcileStripeCommercialAmendmentChargeSnapshot({
    stage: payment.kind as 'AUTHORIZATION' | 'CAPTURE',
    currency: payment.currency,
    amountMinor: payment.amountMinor,
    providerReference: payment.providerReference,
    snapshot: {
      providerReference: intent.providerReference,
      status: intent.status,
      currency: intent.currency,
      amountMinor: intent.amountMinor,
      amountReceivedMinor: intent.amountReceivedMinor,
      amountCapturableMinor: parseCapturableMinor({
        payload: input.payload,
        providerReference: intent.providerReference,
        providerStatus: intent.status,
        amountMinor: intent.amountMinor,
      }),
    },
  });

  const duplicateReferences = await input.transaction.paymentTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      providerCode: STRIPE_PROVIDER_CODE,
      providerReference: intent.providerReference,
      id: { not: payment.id },
    },
    select: { bookingId: true, commercialAmendmentId: true },
    take: 8,
  });
  if (duplicateReferences.some((entry) => (
    entry.bookingId !== selected.bookingId || entry.commercialAmendmentId !== selected.commercialAmendmentId
  ))) {
    throw new PaymentConflictError('Stripe PaymentIntent reference is already recorded outside this commercial amendment.');
  }

  await input.transaction.paymentTransaction.update({
    where: { id: payment.id },
    data: { status: reconciliation.transactionStatus },
  });
  if (payment.kind === 'AUTHORIZATION' && reconciliation.directlySettled) {
    await persistDirectCapture({
      transaction: input.transaction,
      organizationId: input.organizationId,
      bookingId: selected.bookingId,
      amendmentId: selected.commercialAmendmentId,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      providerReference: payment.providerReference,
    });
  }
  await input.transaction.paymentWebhookEvent.update({
    where: { id: input.verifiedWebhookEventId },
    data: {
      bookingId: selected.bookingId,
      providerReference: intent.providerReference,
      status: 'PROCESSED',
      processingNote: reconciliation.transactionStatus === 'AMBIGUOUS'
        ? 'commercial-amendment-charge-awaiting-provider'
        : `commercial-amendment-charge-${reconciliation.transactionStatus.toLowerCase()}`,
      processedAt: new Date(),
    },
  });
  return true;
}

async function finalizeRefund(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  event: StripeWebhookEvent;
  verifiedWebhookEventId: string;
}) {
  const providerRefund = input.event.refund!;
  const candidates = await input.transaction.paymentTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      providerCode: STRIPE_PROVIDER_CODE,
      commercialAmendmentId: { not: null },
      kind: 'REFUND',
      status: 'AMBIGUOUS',
      providerReference: providerRefund.refundReference,
    },
    select: {
      id: true,
      bookingId: true,
      commercialAmendmentId: true,
      providerReference: true,
      sourceProviderReference: true,
      currency: true,
      amountMinor: true,
    },
    take: 8,
  });
  const selected = selectStripeCommercialAmendmentRefundWebhookCandidate({
    refundReference: providerRefund.refundReference,
    paymentIntentReference: providerRefund.paymentIntentReference,
    currency: providerRefund.currency,
    amountMinor: providerRefund.amountMinor,
    candidates: candidates.flatMap((candidate) => candidate.commercialAmendmentId
      ? [{ ...candidate, commercialAmendmentId: candidate.commercialAmendmentId }]
      : []),
  });
  if (!selected) return false;

  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({ organizationId: input.organizationId, bookingId: selected.bookingId })}, 0))`;
  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, selected.bookingId)}, 0))`;

  const refund = await input.transaction.paymentTransaction.findFirst({
    where: {
      id: selected.id,
      organizationId: input.organizationId,
      bookingId: selected.bookingId,
      commercialAmendmentId: selected.commercialAmendmentId,
      providerCode: STRIPE_PROVIDER_CODE,
      kind: 'REFUND',
      status: 'AMBIGUOUS',
      providerReference: providerRefund.refundReference,
    },
  });
  if (!refund) throw new PaymentConflictError('Commercial amendment Stripe refund changed during webhook finalization.');

  const amendment = await input.transaction.hospitalityBookingCommercialAmendment.findFirst({
    where: { id: selected.commercialAmendmentId, organizationId: input.organizationId, bookingId: selected.bookingId },
    select: {
      status: true,
      direction: true,
      paymentProviderCode: true,
      currency: true,
      beforeTotalMinor: true,
      afterTotalMinor: true,
      deltaMinor: true,
    },
  });
  if (!amendment) throw new PaymentConflictError('Commercial amendment is unavailable during Stripe refund webhook finalization.');
  assertRefundAmendment({ amendment, refund });
  if (!refund.sourceProviderReference) throw new PaymentConflictError('Commercial amendment Stripe refund is missing its settlement source.');

  const expectedFingerprint = stripeCommercialAmendmentRefundFingerprint({
    bookingId: selected.bookingId,
    amendmentId: selected.commercialAmendmentId,
    currency: refund.currency,
    amountMinor: refund.amountMinor,
    sourceProviderReference: refund.sourceProviderReference,
  });
  if (refund.requestFingerprint !== expectedFingerprint) {
    throw new PaymentConflictError('Commercial amendment Stripe refund fingerprint is inconsistent.');
  }

  const reconciledStatus = reconcileStripeCommercialAmendmentRefundSnapshot({
    currency: refund.currency,
    amountMinor: refund.amountMinor,
    sourceProviderReference: refund.sourceProviderReference,
    snapshot: {
      paymentIntentReference: providerRefund.paymentIntentReference,
      status: providerRefund.status,
      currency: providerRefund.currency,
      amountMinor: providerRefund.amountMinor,
    },
  });
  const duplicateReference = await input.transaction.paymentTransaction.findFirst({
    where: {
      organizationId: input.organizationId,
      providerCode: STRIPE_PROVIDER_CODE,
      providerReference: providerRefund.refundReference,
      id: { not: refund.id },
    },
    select: { id: true },
  });
  if (duplicateReference) throw new PaymentConflictError('Stripe refund reference is already recorded by another payment transaction.');

  await input.transaction.paymentTransaction.update({
    where: { id: refund.id },
    data: { status: reconciledStatus },
  });
  await input.transaction.paymentWebhookEvent.update({
    where: { id: input.verifiedWebhookEventId },
    data: {
      bookingId: selected.bookingId,
      providerReference: providerRefund.refundReference,
      status: 'PROCESSED',
      processingNote: reconciledStatus === 'AMBIGUOUS'
        ? 'commercial-amendment-refund-awaiting-provider'
        : `commercial-amendment-refund-${reconciledStatus.toLowerCase()}`,
      processedAt: new Date(),
    },
  });
  return true;
}

export async function finalizeVerifiedStripeCommercialAmendmentWebhook(input: {
  organizationId: string;
  verifiedWebhookEventId: string;
  payload: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.verifiedWebhookEventId, 'verifiedWebhookEventId');

  let event: StripeWebhookEvent;
  try {
    event = parseStripeWebhookEventPayload(input.payload);
  } catch (error) {
    if (error instanceof StripeWebhookValidationError) throw new PaymentConflictError(error.message);
    throw error;
  }
  if (!event.paymentIntent && !event.refund) return Object.freeze({ handled: false as const });
  const payloadHash = createHash('sha256').update(input.payload, 'utf8').digest('hex');

  try {
    return await db.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${webhookLockKey(input.organizationId, event.providerEventId)}, 0))`;
      const verifiedEvent = await transaction.paymentWebhookEvent.findFirst({
        where: {
          id: input.verifiedWebhookEventId,
          organizationId: input.organizationId,
          providerCode: STRIPE_PROVIDER_CODE,
          providerEventId: event.providerEventId,
        },
        select: { id: true, eventType: true, payloadHash: true, status: true, processingNote: true },
      });
      if (!verifiedEvent || verifiedEvent.eventType !== event.eventType || verifiedEvent.payloadHash !== payloadHash) {
        throw new PaymentConflictError('Stripe commercial amendment webhook is not backed by the verified event ledger.');
      }
      if (verifiedEvent.status === 'PROCESSED') {
        return Object.freeze({
          handled: verifiedEvent.processingNote.startsWith('commercial-amendment-'),
          idempotent: true as const,
        });
      }

      const handled = event.paymentIntent
        ? await finalizeCharge({
            transaction,
            organizationId: input.organizationId,
            payload: input.payload,
            event,
            verifiedWebhookEventId: verifiedEvent.id,
          })
        : await finalizeRefund({
            transaction,
            organizationId: input.organizationId,
            event,
            verifiedWebhookEventId: verifiedEvent.id,
          });
      return Object.freeze({ handled, idempotent: false as const });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error instanceof StripeCommercialAmendmentWebhookConflictError) {
      throw new PaymentConflictError(error.message);
    }
    throw error;
  }
}
