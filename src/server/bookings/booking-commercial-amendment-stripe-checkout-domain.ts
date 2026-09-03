import { createHash } from 'node:crypto';

import type { StripeCheckoutSessionSnapshot } from '../payments/stripe-checkout-provider.ts';

const CHECKOUT_SESSION_PATTERN = /^cs_[A-Za-z0-9_]+$/;
const PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;
export const STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_PURPOSE = 'commercial-amendment-charge';
export const STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_IDEMPOTENCY_PREFIX = 'ca-stripe-checkout-';

export function stripeCommercialAmendmentCheckoutIdempotencyKey(input: {
  organizationId: string;
  bookingId: string;
  amendmentId: string;
  requestKey: string;
}) {
  const digest = createHash('sha256').update([
    STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_PURPOSE,
    input.organizationId,
    input.bookingId,
    input.amendmentId,
    input.requestKey,
  ].join('\u001f'), 'utf8').digest('hex');
  return `${STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_IDEMPOTENCY_PREFIX}${digest}`;
}

export function stripeCommercialAmendmentCheckoutFingerprint(input: {
  bookingId: string;
  amendmentId: string;
  currency: string;
  amountMinor: bigint;
}) {
  return createHash('sha256').update([
    STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_PURPOSE,
    input.bookingId,
    input.amendmentId,
    input.currency,
    input.amountMinor.toString(),
  ].join('\u001f'), 'utf8').digest('hex');
}

export function hospitalityCommercialAmendmentCheckoutAttemptRequestKey(failedAttempts: number) {
  if (!Number.isSafeInteger(failedAttempts) || failedAttempts < 0 || failedAttempts > 100) {
    throw new Error('Commercial amendment Checkout attempt count is invalid.');
  }
  return `customer-authorized-attempt-${failedAttempts + 1}`;
}

export function isStripeCommercialAmendmentCheckoutSessionReference(value: unknown): value is string {
  return typeof value === 'string' && CHECKOUT_SESSION_PATTERN.test(value) && value.length <= 160;
}

export type StripeCommercialAmendmentCheckoutReconciliation = Readonly<{
  transactionStatus: 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  state: 'PAID' | 'EXPIRED' | 'WAIT_FOR_PROVIDER';
  checkoutReference: string;
  paymentIntentReference: string | null;
}>;

export class StripeCommercialAmendmentCheckoutConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeCommercialAmendmentCheckoutConflictError';
  }
}

export function reconcileStripeCommercialAmendmentCheckoutSnapshot(input: {
  organizationId: string;
  bookingId: string;
  amendmentId: string;
  checkoutReference: string;
  currency: string;
  amountMinor: bigint;
  snapshot: StripeCheckoutSessionSnapshot;
}): StripeCommercialAmendmentCheckoutReconciliation {
  if (!isStripeCommercialAmendmentCheckoutSessionReference(input.checkoutReference)) {
    throw new StripeCommercialAmendmentCheckoutConflictError('Persisted Stripe commercial amendment Checkout Session reference is invalid.');
  }
  if (
    input.snapshot.providerCode !== 'stripe'
    || input.snapshot.sessionReference !== input.checkoutReference
    || input.snapshot.organizationId !== input.organizationId
    || input.snapshot.bookingId !== input.bookingId
    || input.snapshot.commercialAmendmentId !== input.amendmentId
    || input.snapshot.purpose !== STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_PURPOSE
  ) {
    throw new StripeCommercialAmendmentCheckoutConflictError('Stripe commercial amendment Checkout ownership does not match the persisted amendment claim.');
  }
  if (
    input.amountMinor <= 0n
    || input.snapshot.money.currency !== input.currency
    || input.snapshot.money.amountMinor !== input.amountMinor
  ) {
    throw new StripeCommercialAmendmentCheckoutConflictError('Stripe commercial amendment Checkout money does not match the persisted amendment claim.');
  }
  if (
    input.snapshot.paymentIntentReference
    && (!PAYMENT_INTENT_PATTERN.test(input.snapshot.paymentIntentReference) || input.snapshot.paymentIntentReference.length > 160)
  ) {
    throw new StripeCommercialAmendmentCheckoutConflictError('Stripe commercial amendment Checkout PaymentIntent reference is invalid.');
  }

  if (input.snapshot.status === 'complete' && input.snapshot.paymentStatus === 'paid') {
    if (!input.snapshot.paymentIntentReference) {
      throw new StripeCommercialAmendmentCheckoutConflictError('Paid Stripe commercial amendment Checkout is missing its PaymentIntent reference.');
    }
    return Object.freeze({
      transactionStatus: 'SUCCEEDED',
      state: 'PAID',
      checkoutReference: input.checkoutReference,
      paymentIntentReference: input.snapshot.paymentIntentReference,
    });
  }
  if (input.snapshot.status === 'expired' && input.snapshot.paymentStatus === 'unpaid' && !input.snapshot.paymentIntentReference) {
    return Object.freeze({
      transactionStatus: 'FAILED',
      state: 'EXPIRED',
      checkoutReference: input.checkoutReference,
      paymentIntentReference: null,
    });
  }
  if (input.snapshot.paymentStatus === 'no_payment_required') {
    throw new StripeCommercialAmendmentCheckoutConflictError('Positive Stripe commercial amendment Checkout cannot require no payment.');
  }
  if (input.snapshot.paymentStatus === 'paid' && input.snapshot.status !== 'complete') {
    throw new StripeCommercialAmendmentCheckoutConflictError('Paid Stripe commercial amendment Checkout is not complete.');
  }
  return Object.freeze({
    transactionStatus: 'AMBIGUOUS',
    state: 'WAIT_FOR_PROVIDER',
    checkoutReference: input.checkoutReference,
    paymentIntentReference: input.snapshot.paymentIntentReference,
  });
}
