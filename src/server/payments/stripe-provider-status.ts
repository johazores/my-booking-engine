// Unknown Stripe states must never become settlement authority without review.
export const stripePaymentIntentStatuses = [
  'requires_payment_method', 'requires_confirmation', 'requires_action',
  'processing', 'requires_capture', 'canceled', 'succeeded',
] as const;
export const stripeRefundStatuses = [
  'pending', 'requires_action', 'succeeded', 'failed', 'canceled',
] as const;

export type StripePaymentIntentStatus = (typeof stripePaymentIntentStatuses)[number];
export type StripeRefundStatus = (typeof stripeRefundStatuses)[number];

export function isKnownStripePaymentIntentStatus(value: unknown): value is StripePaymentIntentStatus {
  return typeof value === 'string' && (stripePaymentIntentStatuses as readonly string[]).includes(value);
}
export function isKnownStripeRefundStatus(value: unknown): value is StripeRefundStatus {
  return typeof value === 'string' && (stripeRefundStatuses as readonly string[]).includes(value);
}
