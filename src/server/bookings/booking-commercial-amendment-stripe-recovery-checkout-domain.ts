import { createHash } from 'node:crypto';

const CHECKOUT_SESSION_PATTERN = /^cs_[A-Za-z0-9_]+$/;
const CHECKOUT_PURPOSE = 'commercial-amendment-recovery';
export const STRIPE_RECOVERY_CHECKOUT_IDEMPOTENCY_PREFIX = 'ca-stripe-customer-checkout-';

export function stripeCommercialAmendmentRecoveryCheckoutIdempotencyKey(input: {
  organizationId: string;
  bookingId: string;
  amendmentId: string;
  requestKey: string;
}) {
  const digest = createHash('sha256').update([
    CHECKOUT_PURPOSE,
    input.organizationId,
    input.bookingId,
    input.amendmentId,
    input.requestKey,
  ].join('\u001f'), 'utf8').digest('hex');
  return `${STRIPE_RECOVERY_CHECKOUT_IDEMPOTENCY_PREFIX}${digest}`;
}

export function stripeCommercialAmendmentRecoveryCheckoutFingerprint(input: {
  bookingId: string;
  amendmentId: string;
  currency: string;
  amountMinor: bigint;
}) {
  return createHash('sha256').update([
    CHECKOUT_PURPOSE,
    input.bookingId,
    input.amendmentId,
    input.currency,
    input.amountMinor.toString(),
  ].join('\u001f'), 'utf8').digest('hex');
}

export function isStripeCheckoutSessionReference(value: unknown): value is string {
  return typeof value === 'string' && CHECKOUT_SESSION_PATTERN.test(value) && value.length <= 160;
}
