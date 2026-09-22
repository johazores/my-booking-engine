import { parseStripeWebhookEventPayload } from '../payments/stripe-webhook-domain.ts';
import {
  STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_PURPOSE,
  isStripeCommercialAmendmentCheckoutSessionReference,
} from './booking-commercial-amendment-stripe-checkout-domain.ts';

const PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;

export function parseStripeCommercialAmendmentCheckoutWebhook(payload: string) {
  const event = parseStripeWebhookEventPayload(payload);
  if (!event.checkoutSession) return null;

  const checkout = event.checkoutSession;
  if (!checkout.organizationId || !checkout.bookingId) return null;
  if (checkout.mode !== 'payment' || checkout.clientReferenceId !== checkout.bookingId || !checkout.expiresAt) return null;
  if (!checkout.commercialContext || checkout.commercialContext.purpose !== STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_PURPOSE) return null;
  if (!checkout.commercialContext.amendmentId) return null;
  if (!isStripeCommercialAmendmentCheckoutSessionReference(checkout.providerReference)) return null;
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
