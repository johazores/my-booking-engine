import { parseStripeWebhookEventPayload } from '../payments/stripe-webhook-domain.ts';
import { isStripeCheckoutSessionReference } from './booking-commercial-amendment-stripe-recovery-checkout-domain.ts';

const PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const CHECKOUT_PURPOSE = 'commercial-amendment-recovery';

export function parseStripeCommercialAmendmentRecoveryCheckoutWebhook(payload: string) {
  const event = parseStripeWebhookEventPayload(payload);
  if (!event.checkoutSession) return null;

  const checkout = event.checkoutSession;
  if (!checkout.organizationId || !checkout.bookingId) return null;
  if (checkout.mode !== 'payment' || checkout.clientReferenceId !== checkout.bookingId || !checkout.expiresAt) return null;
  if (!checkout.commercialContext || checkout.commercialContext.purpose !== CHECKOUT_PURPOSE) return null;
  if (!checkout.commercialContext.amendmentId) return null;
  if (!isStripeCheckoutSessionReference(checkout.providerReference)) return null;
  if (checkout.paymentIntentReference && !PAYMENT_INTENT_PATTERN.test(checkout.paymentIntentReference)) return null;

  return Object.freeze({
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    providerCreatedAt: event.providerCreatedAt,
    organizationId: checkout.organizationId,
    bookingId: checkout.bookingId,
    amendmentId: checkout.commercialContext.amendmentId,
    checkoutReference: checkout.providerReference,
    checkoutStatus: checkout.status,
    paymentStatus: checkout.paymentStatus,
    paymentIntentReference: checkout.paymentIntentReference,
    currency: checkout.currency,
    amountMinor: checkout.amountTotalMinor,
    checkoutExpiresAt: checkout.expiresAt,
  });
}
