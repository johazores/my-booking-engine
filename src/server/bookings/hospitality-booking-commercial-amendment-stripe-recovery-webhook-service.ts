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
  reconcileStripeCommercialAmendmentChargeSnapshot,
} from './booking-commercial-amendment-stripe-charge-domain.ts';
import {
  reconcileStripeCommercialAmendmentRefundSnapshot,
} from './booking-commercial-amendment-stripe-refund-domain.ts';
import {
  StripeCommercialAmendmentRecoveryWebhookConflictError,
  assertStripeCommercialAmendmentRecoveryWebhookIdentity,
} from './booking-commercial-amendment-stripe-recovery-webhook-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';

const STRIPE_PROVIDER_CODE = 'stripe';
const RECOVERY_CAPTURE_PREFIX = 'ca-stripe-recovery-capture-';
const RECOVERY_REFUND_PREFIX = 'ca-stripe-recovery-refund-';

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
    throw new PaymentConflictError('Verified Stripe recovery PaymentIntent payload is invalid.');
  }
  const record = object as Record<string, unknown>;
  if (record.id !== input.providerReference) {
    throw new PaymentConflictError('Verified Stripe recovery PaymentIntent identity changed during webhook finalization.');
  }
  const value = record.amount_capturable ?? 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new PaymentConflictError('Verified Stripe recovery PaymentIntent capturable amount is invalid.');
  }
  const amountCapturableMinor = BigInt(Number(value));
  if (amountCapturableMinor > input.amountMinor) {
    throw new PaymentConflictError('Verified Stripe recovery PaymentIntent capturable amount exceeds the payment amount.');
  }
  if (input.providerStatus === 'requires_capture' && amountCapturableMinor === 0n) {
    throw new PaymentConflictError('Verified Stripe recovery PaymentIntent is missing its capturable amount.');
  }
  return amountCapturableMinor;
}

function assertExpiredRecoveryAmendment(input: {
  amendment: {
    status: string;
    direction: string;
    paymentProviderCode: string;
    currency: string;
    beforeTotalMinor: bigint;
    afterTotalMinor: bigint;
    deltaMinor: bigint;
    expiresAt: Date;
  };
  kind: 'CAPTURE' | 'REFUND';
  currency: string;
  amountMinor: bigint;
  now: Date;
}) {
  if (
    input.amendment.status !== 'PREPARED'
    || input.amendment.paymentProviderCode !== STRIPE_PROVIDER_CODE
    || input.amendment.currency !== input.currency
    || input.amendment.expiresAt.getTime() > input.now.getTime()
    || input.amountMinor <= 0n
  ) {
    throw new PaymentConflictError(
      'Commercial amendment no longer matches expired Stripe recovery webhook evidence.',
    );
  }

  if (input.kind === 'CAPTURE') {
    const refundableDeltaMinor = input.amendment.beforeTotalMinor - input.amendment.afterTotalMinor;
    if (
      input.amendment.direction !== 'REFUND'
      || input.amendment.deltaMinor >= 0n
      || refundableDeltaMinor !== -input.amendment.deltaMinor
      || input.amountMinor > refundableDeltaMinor
    ) {
      throw new PaymentConflictError(
        'Expired refund amendment no longer matches Stripe compensation-capture webhook evidence.',
      );
    }
    return;
  }

  const additionalChargeMinor = input.amendment.afterTotalMinor - input.amendment.beforeTotalMinor;
  if (
    input.amendment.direction !== 'ADDITIONAL_CHARGE'
    || input.amendment.deltaMinor <= 0n
    || additionalChargeMinor !== input.amendment.deltaMinor
    || input.amountMinor > additionalChargeMinor
  ) {
    throw new PaymentConflictError(
      'Expired additional-charge amendment no longer matches Stripe compensation-refund webhook evidence.',
    );
  }
}

async function lockRecoveryBooking(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
}) {
  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
    organizationId: input.organizationId,
    bookingId: input.bookingId,
  })}, 0))`;
  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(
    input.organizationId,
    input.bookingId,
  )}, 0))`;
}

async function finalizeRecoveryCapture(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  payload: string;
  event: StripeWebhookEvent;
  verifiedWebhookEventId: string;
  now: Date;
}) {
  const intent = input.event.paymentIntent!;
  if (intent.organizationId && intent.organizationId !== input.organizationId) return false;

  const candidates = await input.transaction.paymentTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      providerCode: STRIPE_PROVIDER_CODE,
      commercialAmendmentId: { not: null },
      kind: 'CAPTURE',
      status: 'AMBIGUOUS',
      providerReference: intent.providerReference,
      idempotencyKey: { startsWith: RECOVERY_CAPTURE_PREFIX },
    },
    select: {
      id: true,
      bookingId: true,
      commercialAmendmentId: true,
      idempotencyKey: true,
      requestFingerprint: true,
      kind: true,
      providerReference: true,
      sourceProviderReference: true,
      currency: true,
      amountMinor: true,
    },
    take: 8,
  });
  if (candidates.length > 1) {
    throw new PaymentConflictError(
      'Stripe PaymentIntent matches multiple commercial amendment recovery captures.',
    );
  }
  const selected = candidates[0];
  if (!selected?.commercialAmendmentId) return false;
  if (intent.bookingId && intent.bookingId !== selected.bookingId) {
    throw new PaymentConflictError(
      'Stripe recovery PaymentIntent booking metadata does not match the persisted recovery operation.',
    );
  }

  await lockRecoveryBooking({
    transaction: input.transaction,
    organizationId: input.organizationId,
    bookingId: selected.bookingId,
  });

  const payment = await input.transaction.paymentTransaction.findFirst({
    where: {
      id: selected.id,
      organizationId: input.organizationId,
      bookingId: selected.bookingId,
      commercialAmendmentId: selected.commercialAmendmentId,
      providerCode: STRIPE_PROVIDER_CODE,
      kind: 'CAPTURE',
      status: 'AMBIGUOUS',
      providerReference: intent.providerReference,
      idempotencyKey: selected.idempotencyKey,
    },
  });
  if (!payment) {
    throw new PaymentConflictError(
      'Commercial amendment Stripe recovery capture changed during webhook finalization.',
    );
  }

  assertStripeCommercialAmendmentRecoveryWebhookIdentity({
    bookingId: payment.bookingId,
    commercialAmendmentId: selected.commercialAmendmentId,
    idempotencyKey: payment.idempotencyKey,
    requestFingerprint: payment.requestFingerprint,
    kind: 'CAPTURE',
    providerReference: payment.providerReference,
    sourceProviderReference: payment.sourceProviderReference,
    currency: payment.currency,
    amountMinor: payment.amountMinor,
  });

  const amendment = await input.transaction.hospitalityBookingCommercialAmendment.findFirst({
    where: {
      id: selected.commercialAmendmentId,
      organizationId: input.organizationId,
      bookingId: selected.bookingId,
    },
    select: {
      status: true,
      direction: true,
      paymentProviderCode: true,
      currency: true,
      beforeTotalMinor: true,
      afterTotalMinor: true,
      deltaMinor: true,
      expiresAt: true,
    },
  });
  if (!amendment) {
    throw new PaymentConflictError(
      'Commercial amendment is unavailable during Stripe recovery webhook finalization.',
    );
  }
  assertExpiredRecoveryAmendment({
    amendment,
    kind: 'CAPTURE',
    currency: payment.currency,
    amountMinor: payment.amountMinor,
    now: input.now,
  });

  let reconciliation;
  try {
    reconciliation = reconcileStripeCommercialAmendmentChargeSnapshot({
      stage: 'CAPTURE',
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
  } catch (error) {
    throw new PaymentConflictError(
      error instanceof Error
        ? error.message
        : 'Stripe recovery capture webhook evidence is invalid.',
    );
  }

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
    entry.bookingId !== selected.bookingId
    || entry.commercialAmendmentId !== selected.commercialAmendmentId
  ))) {
    throw new PaymentConflictError(
      'Stripe recovery PaymentIntent reference is already recorded outside this commercial amendment.',
    );
  }

  await input.transaction.paymentTransaction.update({
    where: { id: payment.id },
    data: { status: reconciliation.transactionStatus },
  });
  await input.transaction.paymentWebhookEvent.update({
    where: { id: input.verifiedWebhookEventId },
    data: {
      bookingId: selected.bookingId,
      providerReference: intent.providerReference,
      status: 'PROCESSED',
      processingNote: reconciliation.transactionStatus === 'AMBIGUOUS'
        ? 'commercial-amendment-recovery-capture-awaiting-provider'
        : `commercial-amendment-recovery-capture-${reconciliation.transactionStatus.toLowerCase()}`,
      processedAt: new Date(),
    },
  });
  return true;
}

async function finalizeRecoveryRefund(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  event: StripeWebhookEvent;
  verifiedWebhookEventId: string;
  now: Date;
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
      idempotencyKey: { startsWith: RECOVERY_REFUND_PREFIX },
    },
    select: {
      id: true,
      bookingId: true,
      commercialAmendmentId: true,
      idempotencyKey: true,
      requestFingerprint: true,
      kind: true,
      providerReference: true,
      sourceProviderReference: true,
      currency: true,
      amountMinor: true,
    },
    take: 8,
  });
  if (candidates.length > 1) {
    throw new PaymentConflictError(
      'Stripe refund matches multiple commercial amendment recovery refunds.',
    );
  }
  const selected = candidates[0];
  if (!selected?.commercialAmendmentId) return false;

  await lockRecoveryBooking({
    transaction: input.transaction,
    organizationId: input.organizationId,
    bookingId: selected.bookingId,
  });

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
      idempotencyKey: selected.idempotencyKey,
    },
  });
  if (!refund) {
    throw new PaymentConflictError(
      'Commercial amendment Stripe recovery refund changed during webhook finalization.',
    );
  }

  const identity = assertStripeCommercialAmendmentRecoveryWebhookIdentity({
    bookingId: refund.bookingId,
    commercialAmendmentId: selected.commercialAmendmentId,
    idempotencyKey: refund.idempotencyKey,
    requestFingerprint: refund.requestFingerprint,
    kind: 'REFUND',
    providerReference: refund.providerReference,
    sourceProviderReference: refund.sourceProviderReference,
    currency: refund.currency,
    amountMinor: refund.amountMinor,
  });
  if (identity.providerReference !== providerRefund.paymentIntentReference) {
    throw new PaymentConflictError(
      'Stripe recovery refund webhook source does not match the persisted compensation source.',
    );
  }

  const amendment = await input.transaction.hospitalityBookingCommercialAmendment.findFirst({
    where: {
      id: selected.commercialAmendmentId,
      organizationId: input.organizationId,
      bookingId: selected.bookingId,
    },
    select: {
      status: true,
      direction: true,
      paymentProviderCode: true,
      currency: true,
      beforeTotalMinor: true,
      afterTotalMinor: true,
      deltaMinor: true,
      expiresAt: true,
    },
  });
  if (!amendment) {
    throw new PaymentConflictError(
      'Commercial amendment is unavailable during Stripe recovery refund webhook finalization.',
    );
  }
  assertExpiredRecoveryAmendment({
    amendment,
    kind: 'REFUND',
    currency: refund.currency,
    amountMinor: refund.amountMinor,
    now: input.now,
  });

  let reconciledStatus;
  try {
    reconciledStatus = reconcileStripeCommercialAmendmentRefundSnapshot({
      currency: refund.currency,
      amountMinor: refund.amountMinor,
      sourceProviderReference: identity.providerReference,
      snapshot: {
        paymentIntentReference: providerRefund.paymentIntentReference,
        status: providerRefund.status,
        currency: providerRefund.currency,
        amountMinor: providerRefund.amountMinor,
      },
    });
  } catch (error) {
    throw new PaymentConflictError(
      error instanceof Error
        ? error.message
        : 'Stripe recovery refund webhook evidence is invalid.',
    );
  }

  const duplicateReference = await input.transaction.paymentTransaction.findFirst({
    where: {
      organizationId: input.organizationId,
      providerCode: STRIPE_PROVIDER_CODE,
      providerReference: providerRefund.refundReference,
      id: { not: refund.id },
    },
    select: { id: true },
  });
  if (duplicateReference) {
    throw new PaymentConflictError(
      'Stripe recovery refund reference is already recorded by another payment transaction.',
    );
  }

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
        ? 'commercial-amendment-recovery-refund-awaiting-provider'
        : `commercial-amendment-recovery-refund-${reconciledStatus.toLowerCase()}`,
      processedAt: new Date(),
    },
  });
  return true;
}

export async function finalizeVerifiedStripeCommercialAmendmentRecoveryWebhook(input: {
  organizationId: string;
  verifiedWebhookEventId: string;
  payload: string;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.verifiedWebhookEventId, 'verifiedWebhookEventId');

  let event: StripeWebhookEvent;
  try {
    event = parseStripeWebhookEventPayload(input.payload);
  } catch (error) {
    if (error instanceof StripeWebhookValidationError) {
      throw new PaymentConflictError(error.message);
    }
    throw error;
  }
  if (!event.paymentIntent && !event.refund) {
    return Object.freeze({ handled: false as const });
  }
  const payloadHash = createHash('sha256').update(input.payload, 'utf8').digest('hex');
  const now = input.now ?? new Date();

  try {
    return await db.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${webhookLockKey(
        input.organizationId,
        event.providerEventId,
      )}, 0))`;
      const verifiedEvent = await transaction.paymentWebhookEvent.findFirst({
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
          status: true,
          processingNote: true,
        },
      });
      if (
        !verifiedEvent
        || verifiedEvent.eventType !== event.eventType
        || verifiedEvent.payloadHash !== payloadHash
      ) {
        throw new PaymentConflictError(
          'Stripe commercial amendment recovery webhook is not backed by the verified event ledger.',
        );
      }
      if (verifiedEvent.status === 'PROCESSED') {
        return Object.freeze({
          handled: verifiedEvent.processingNote.startsWith('commercial-amendment-recovery-'),
          idempotent: true as const,
        });
      }

      const handled = event.paymentIntent
        ? await finalizeRecoveryCapture({
            transaction,
            organizationId: input.organizationId,
            payload: input.payload,
            event,
            verifiedWebhookEventId: verifiedEvent.id,
            now,
          })
        : await finalizeRecoveryRefund({
            transaction,
            organizationId: input.organizationId,
            event,
            verifiedWebhookEventId: verifiedEvent.id,
            now,
          });
      return Object.freeze({ handled, idempotent: false as const });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error instanceof StripeCommercialAmendmentRecoveryWebhookConflictError) {
      throw new PaymentConflictError(error.message);
    }
    throw error;
  }
}
