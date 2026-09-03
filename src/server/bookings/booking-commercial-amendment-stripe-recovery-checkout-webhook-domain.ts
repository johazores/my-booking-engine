import { parseStripeWebhookEventPayload } from '../payments/stripe-webhook-domain.ts';
import { isStripeCheckoutSessionReference } from './booking-commercial-amendment-stripe-recovery-checkout-domain.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const CHECKOUT_PURPOSE = 'commercial-amendment-recovery';

export function parseStripeCommercialAmendmentRecoveryCheckoutWebhook(payload: string) {
  const event = parseStripeWebhookEventPayload(payload);
  if (!event.checkoutSession) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const data = (parsed as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const object = (data as { object?: unknown }).object;
  if (!object || typeof object !== 'object' || Array.isArray(object)) return null;
  const metadata = (object as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  if (record.sf_checkout_purpose !== CHECKOUT_PURPOSE) return null;
  const amendmentId = typeof record.sf_commercial_amendment_id === 'string'
    ? record.sf_commercial_amendment_id.trim().toLowerCase()
    : '';
  if (!UUID_PATTERN.test(amendmentId)) return null;

  const checkout = event.checkoutSession;
  if (!checkout.organizationId || !checkout.bookingId) return null;
  if (!isStripeCheckoutSessionReference(checkout.providerReference)) return null;
  if (checkout.paymentIntentReference && !PAYMENT_INTENT_PATTERN.test(checkout.paymentIntentReference)) return null;

  return Object.freeze({
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    providerCreatedAt: event.providerCreatedAt,
    organizationId: checkout.organizationId,
    bookingId: checkout.bookingId,
    amendmentId,
    checkoutReference: checkout.providerReference,
    checkoutStatus: checkout.status,
    paymentStatus: checkout.paymentStatus,
    paymentIntentReference: checkout.paymentIntentReference,
    currency: checkout.currency,
    amountMinor: checkout.amountTotalMinor,
  });
}
