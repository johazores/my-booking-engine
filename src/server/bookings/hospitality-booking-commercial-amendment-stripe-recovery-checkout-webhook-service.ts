import { createHash } from 'node:crypto';

import type { Prisma } from '../../generated/prisma/client.ts';
import { db } from '../database.ts';
import { PaymentConflictError } from '../payments/payment-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  STRIPE_RECOVERY_CHECKOUT_IDEMPOTENCY_PREFIX,
  stripeCommercialAmendmentRecoveryCheckoutFingerprint,
} from './booking-commercial-amendment-stripe-recovery-checkout-domain.ts';
import { parseStripeCommercialAmendmentRecoveryCheckoutWebhook } from './booking-commercial-amendment-stripe-recovery-checkout-webhook-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';

const STRIPE_PROVIDER_CODE = 'stripe';

function paymentLockKey(organizationId: string, bookingId: string) {
  return `payment:${organizationId}:booking:${bookingId}`;
}

function webhookLockKey(organizationId: string, providerEventId: string) {
  return `payment:${organizationId}:webhook:${providerEventId}`;
}

async function lockCheckoutRecovery(input: {
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

export async function finalizeVerifiedStripeCommercialAmendmentRecoveryCheckoutWebhook(input: {
  organizationId: string;
  verifiedWebhookEventId: string;
  payload: string;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.verifiedWebhookEventId, 'verifiedWebhookEventId');
  const evidence = parseStripeCommercialAmendmentRecoveryCheckoutWebhook(input.payload);
  if (!evidence) return { handled: false as const };
  if (evidence.organizationId !== input.organizationId) {
    throw new PaymentConflictError('Stripe recovery Checkout tenant metadata does not match the verified webhook tenant.');
  }
  const payloadHash = createHash('sha256').update(input.payload, 'utf8').digest('hex');
  const processedAt = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
    await lockCheckoutRecovery({
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
    if (!verifiedEvent) {
      throw new PaymentConflictError('Verified Stripe recovery Checkout webhook event is unavailable.');
    }
    if (verifiedEvent.eventType !== evidence.eventType || verifiedEvent.payloadHash !== payloadHash) {
      throw new PaymentConflictError('Verified Stripe recovery Checkout webhook evidence changed before finalization.');
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
        idempotencyKey: { startsWith: STRIPE_RECOVERY_CHECKOUT_IDEMPOTENCY_PREFIX },
      },
      take: 3,
    });
    if (candidates.length > 1) {
      throw new PaymentConflictError('Stripe recovery Checkout Session matches multiple amendment payment claims.');
    }
    const payment = candidates[0];
    if (!payment) return { handled: false as const };

    const amendment = await transaction.hospitalityBookingCommercialAmendment.findFirst({
      where: {
        id: evidence.amendmentId,
        organizationId: input.organizationId,
        bookingId: evidence.bookingId,
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
    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: evidence.bookingId, organizationId: input.organizationId },
      select: { status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!amendment || !booking) {
      throw new PaymentConflictError('Stripe recovery Checkout ownership is no longer available.');
    }
    if (
      amendment.status !== 'PREPARED'
      || amendment.direction !== 'REFUND'
      || amendment.paymentProviderCode !== STRIPE_PROVIDER_CODE
      || amendment.currency !== evidence.currency
      || amendment.expiresAt.getTime() > processedAt.getTime()
      || booking.status !== 'CONFIRMED'
      || booking.paymentStatus !== 'PAID'
      || booking.currency !== amendment.currency
      || booking.totalMinor !== amendment.beforeTotalMinor
    ) {
      throw new PaymentConflictError('Stripe recovery Checkout no longer matches the expired amendment booking snapshot.');
    }
    const refundableDeltaMinor = amendment.beforeTotalMinor - amendment.afterTotalMinor;
    if (amendment.deltaMinor >= 0n || refundableDeltaMinor !== -amendment.deltaMinor || payment.amountMinor > refundableDeltaMinor) {
      throw new PaymentConflictError('Stripe recovery Checkout amount exceeds the expired refund amendment boundary.');
    }
    if (
      payment.currency !== evidence.currency
      || payment.amountMinor !== evidence.amountMinor
      || payment.sourceProviderReference !== null
      || payment.requestFingerprint !== stripeCommercialAmendmentRecoveryCheckoutFingerprint({
        bookingId: evidence.bookingId,
        amendmentId: evidence.amendmentId,
        currency: evidence.currency,
        amountMinor: evidence.amountMinor,
      })
    ) {
      throw new PaymentConflictError('Stripe recovery Checkout money or operation identity does not match the persisted claim.');
    }

    if (evidence.eventType === 'checkout.session.expired') {
      if (
        evidence.checkoutStatus === 'expired'
        && evidence.paymentStatus === 'unpaid'
        && !evidence.paymentIntentReference
      ) {
        await transaction.paymentTransaction.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
        await transaction.paymentWebhookEvent.update({
          where: { id: verifiedEvent.id },
          data: {
            bookingId: evidence.bookingId,
            providerReference: evidence.checkoutReference,
            status: 'PROCESSED',
            processingNote: 'commercial-amendment-recovery-checkout-expired',
            processedAt,
          },
        });
        return { handled: true as const, state: 'FAILED' as const };
      }
      await transaction.paymentWebhookEvent.update({
        where: { id: verifiedEvent.id },
        data: {
          bookingId: evidence.bookingId,
          providerReference: evidence.checkoutReference,
          status: 'PROCESSED',
          processingNote: 'commercial-amendment-recovery-checkout-expiry-preserved',
          processedAt,
        },
      });
      return { handled: true as const, state: 'AMBIGUOUS' as const };
    }

    if (evidence.eventType !== 'checkout.session.completed') {
      return { handled: false as const };
    }
    if (evidence.checkoutStatus !== 'complete') {
      throw new PaymentConflictError('Stripe recovery Checkout completed event has a non-complete Session state.');
    }
    if (evidence.paymentStatus !== 'paid') {
      await transaction.paymentWebhookEvent.update({
        where: { id: verifiedEvent.id },
        data: {
          bookingId: evidence.bookingId,
          providerReference: evidence.checkoutReference,
          status: 'PROCESSED',
          processingNote: 'commercial-amendment-recovery-checkout-awaiting-payment',
          processedAt,
        },
      });
      return { handled: true as const, state: 'AMBIGUOUS' as const };
    }
    if (!evidence.paymentIntentReference) {
      throw new PaymentConflictError('Paid Stripe recovery Checkout Session is missing its PaymentIntent reference.');
    }

    const providerReferenceConflict = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: evidence.paymentIntentReference,
        id: { not: payment.id },
      },
      select: { id: true },
    });
    if (providerReferenceConflict) {
      throw new PaymentConflictError('Stripe recovery Checkout PaymentIntent is already bound to another payment transaction.');
    }

    await transaction.paymentTransaction.update({
      where: { id: payment.id },
      data: { providerReference: evidence.paymentIntentReference, status: 'SUCCEEDED' },
    });
    await transaction.paymentWebhookEvent.update({
      where: { id: verifiedEvent.id },
      data: {
        bookingId: evidence.bookingId,
        providerReference: evidence.paymentIntentReference,
        status: 'PROCESSED',
        processingNote: 'commercial-amendment-recovery-checkout-paid',
        processedAt,
      },
    });
    return { handled: true as const, state: 'SUCCEEDED' as const };
  }, { isolationLevel: 'Serializable' });
}
