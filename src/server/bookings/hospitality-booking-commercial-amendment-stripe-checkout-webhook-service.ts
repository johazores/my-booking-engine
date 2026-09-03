import { createHash } from 'node:crypto';

import type { Prisma } from '../../generated/prisma/client.ts';
import { db } from '../database.ts';
import { PaymentConflictError } from '../payments/payment-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_IDEMPOTENCY_PREFIX,
  StripeCommercialAmendmentCheckoutConflictError,
  reconcileStripeCommercialAmendmentCheckoutSnapshot,
  stripeCommercialAmendmentCheckoutFingerprint,
} from './booking-commercial-amendment-stripe-checkout-domain.ts';
import { parseStripeCommercialAmendmentCheckoutWebhook } from './booking-commercial-amendment-stripe-checkout-webhook-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';

const STRIPE_PROVIDER_CODE = 'stripe';

function paymentLockKey(organizationId: string, bookingId: string) {
  return `payment:${organizationId}:booking:${bookingId}`;
}

function webhookLockKey(organizationId: string, providerEventId: string) {
  return `payment:${organizationId}:webhook:${providerEventId}`;
}

async function lockCommercialCheckout(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  providerEventId: string;
}) {
  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${webhookLockKey(input.organizationId, input.providerEventId)}, 0))`;
  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
    organizationId: input.organizationId,
    bookingId: input.bookingId,
  })}, 0))`;
  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, input.bookingId)}, 0))`;
}

export async function finalizeVerifiedStripeCommercialAmendmentCheckoutWebhook(input: {
  organizationId: string;
  verifiedWebhookEventId: string;
  payload: string;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.verifiedWebhookEventId, 'verifiedWebhookEventId');
  const evidence = parseStripeCommercialAmendmentCheckoutWebhook(input.payload);
  if (!evidence) return { handled: false as const };
  if (evidence.organizationId !== input.organizationId) {
    throw new PaymentConflictError('Stripe commercial amendment Checkout tenant metadata does not match the verified webhook tenant.');
  }
  if (evidence.eventType !== 'checkout.session.completed' && evidence.eventType !== 'checkout.session.expired') {
    return { handled: false as const };
  }

  const payloadHash = createHash('sha256').update(input.payload, 'utf8').digest('hex');
  const processedAt = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
    await lockCommercialCheckout({
      transaction,
      organizationId: input.organizationId,
      bookingId: evidence.bookingId,
      providerEventId: evidence.providerEventId,
    });

    const verifiedEvent = await transaction.paymentWebhookEvent.findFirst({
      where: {
        id: input.verifiedWebhookEventId,
        organizationId: input.organizationId,
        providerCode: STRIPE_PROVIDER_CODE,
        providerEventId: evidence.providerEventId,
      },
    });
    if (!verifiedEvent) throw new PaymentConflictError('Verified Stripe commercial amendment Checkout webhook event is unavailable.');
    if (verifiedEvent.eventType !== evidence.eventType || verifiedEvent.payloadHash !== payloadHash) {
      throw new PaymentConflictError('Verified Stripe commercial amendment Checkout webhook evidence changed before finalization.');
    }

    const candidates = await transaction.paymentTransaction.findMany({
      where: {
        organizationId: input.organizationId,
        bookingId: evidence.bookingId,
        commercialAmendmentId: evidence.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'CAPTURE',
        status: 'AMBIGUOUS',
        providerReference: evidence.checkoutReference,
        idempotencyKey: { startsWith: STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_IDEMPOTENCY_PREFIX },
      },
      take: 3,
    });
    if (candidates.length > 1) throw new PaymentConflictError('Stripe commercial amendment Checkout Session matches multiple payment claims.');
    const payment = candidates[0];
    if (!payment) return { handled: false as const };

    const amendment = await transaction.hospitalityBookingCommercialAmendment.findFirst({
      where: { id: evidence.amendmentId, organizationId: input.organizationId, bookingId: evidence.bookingId },
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
    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: evidence.bookingId, organizationId: input.organizationId },
      select: { status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!amendment || !booking) throw new PaymentConflictError('Stripe commercial amendment Checkout ownership is no longer available.');
    if (
      amendment.status !== 'PREPARED'
      || amendment.direction !== 'ADDITIONAL_CHARGE'
      || amendment.paymentProviderCode !== STRIPE_PROVIDER_CODE
      || amendment.currency !== evidence.currency
      || booking.status !== 'CONFIRMED'
      || booking.paymentStatus !== 'PAID'
      || booking.currency !== amendment.currency
      || booking.totalMinor !== amendment.beforeTotalMinor
    ) {
      throw new PaymentConflictError('Stripe commercial amendment Checkout no longer matches the prepared booking snapshot.');
    }
    const additionalChargeMinor = amendment.afterTotalMinor - amendment.beforeTotalMinor;
    if (amendment.deltaMinor <= 0n || additionalChargeMinor !== amendment.deltaMinor || payment.amountMinor > amendment.deltaMinor) {
      throw new PaymentConflictError('Stripe commercial amendment Checkout amount exceeds the prepared additional-charge boundary.');
    }
    if (
      payment.currency !== evidence.currency
      || payment.amountMinor !== evidence.amountMinor
      || payment.sourceProviderReference !== null
      || payment.requestFingerprint !== stripeCommercialAmendmentCheckoutFingerprint({
        bookingId: evidence.bookingId,
        amendmentId: evidence.amendmentId,
        currency: evidence.currency,
        amountMinor: evidence.amountMinor,
      })
    ) {
      throw new PaymentConflictError('Stripe commercial amendment Checkout money or operation identity does not match the persisted claim.');
    }

    let reconciliation;
    try {
      reconciliation = reconcileStripeCommercialAmendmentCheckoutSnapshot({
        organizationId: input.organizationId,
        bookingId: evidence.bookingId,
        amendmentId: evidence.amendmentId,
        checkoutReference: evidence.checkoutReference,
        currency: evidence.currency,
        amountMinor: evidence.amountMinor,
        snapshot: {
          providerCode: STRIPE_PROVIDER_CODE,
          sessionReference: evidence.checkoutReference,
          status: evidence.checkoutStatus,
          paymentStatus: evidence.paymentStatus,
          paymentIntentReference: evidence.paymentIntentReference,
          money: { currency: evidence.currency, amountMinor: evidence.amountMinor },
          organizationId: evidence.organizationId,
          bookingId: evidence.bookingId,
          commercialAmendmentId: evidence.amendmentId,
          purpose: 'commercial-amendment-charge',
        },
      });
    } catch (error) {
      throw new PaymentConflictError(
        error instanceof StripeCommercialAmendmentCheckoutConflictError
          ? error.message
          : 'Stripe commercial amendment Checkout webhook provider truth is invalid.',
      );
    }

    if (reconciliation.transactionStatus === 'AMBIGUOUS') {
      await transaction.paymentWebhookEvent.update({
        where: { id: verifiedEvent.id },
        data: {
          bookingId: evidence.bookingId,
          providerReference: evidence.checkoutReference,
          status: 'PROCESSED',
          processingNote: amendment.expiresAt <= processedAt
            ? 'commercial-amendment-checkout-late-provider-state-preserved'
            : 'commercial-amendment-checkout-awaiting-payment',
          processedAt,
        },
      });
      return { handled: true as const, state: 'AMBIGUOUS' as const };
    }

    if (reconciliation.transactionStatus === 'SUCCEEDED') {
      if (!reconciliation.paymentIntentReference) throw new PaymentConflictError('Paid Stripe commercial amendment Checkout is missing its PaymentIntent reference.');
      const duplicate = await transaction.paymentTransaction.findFirst({
        where: {
          organizationId: input.organizationId,
          providerCode: STRIPE_PROVIDER_CODE,
          providerReference: reconciliation.paymentIntentReference,
          id: { not: payment.id },
        },
        select: { id: true },
      });
      if (duplicate) throw new PaymentConflictError('Stripe commercial amendment Checkout PaymentIntent is already bound to another payment transaction.');
    }

    const updated = await transaction.paymentTransaction.update({
      where: { id: payment.id },
      data: {
        status: reconciliation.transactionStatus,
        providerReference: reconciliation.paymentIntentReference ?? payment.providerReference,
      },
    });
    await transaction.paymentWebhookEvent.update({
      where: { id: verifiedEvent.id },
      data: {
        bookingId: evidence.bookingId,
        providerReference: updated.providerReference,
        status: 'PROCESSED',
        processingNote: reconciliation.transactionStatus === 'SUCCEEDED'
          ? amendment.expiresAt <= processedAt
            ? 'commercial-amendment-checkout-paid-after-expiry-recovery-required'
            : 'commercial-amendment-checkout-paid'
          : 'commercial-amendment-checkout-expired',
        processedAt,
      },
    });
    return { handled: true as const, state: reconciliation.transactionStatus };
  }, { isolationLevel: 'Serializable' });
}
