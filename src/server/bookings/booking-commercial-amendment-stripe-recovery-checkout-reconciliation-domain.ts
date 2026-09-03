import type { StripeCheckoutSessionSnapshot } from '../payments/stripe-checkout-provider.ts';
import { isStripeCheckoutSessionReference } from './booking-commercial-amendment-stripe-recovery-checkout-domain.ts';

const PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const CHECKOUT_PURPOSE = 'commercial-amendment-recovery';

export type StripeCommercialAmendmentRecoveryCheckoutReconciliation = Readonly<{
  transactionStatus: 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  state: 'PAID' | 'EXPIRED' | 'WAIT_FOR_PROVIDER';
  checkoutReference: string;
  paymentIntentReference: string | null;
}>;

export class StripeCommercialAmendmentRecoveryCheckoutConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeCommercialAmendmentRecoveryCheckoutConflictError';
  }
}

export function reconcileStripeCommercialAmendmentRecoveryCheckoutSnapshot(input: {
  organizationId: string;
  bookingId: string;
  amendmentId: string;
  checkoutReference: string;
  currency: string;
  amountMinor: bigint;
  snapshot: StripeCheckoutSessionSnapshot;
}): StripeCommercialAmendmentRecoveryCheckoutReconciliation {
  if (!isStripeCheckoutSessionReference(input.checkoutReference)) {
    throw new StripeCommercialAmendmentRecoveryCheckoutConflictError('Persisted Stripe recovery Checkout Session reference is invalid.');
  }
  if (
    input.snapshot.providerCode !== 'stripe'
    || input.snapshot.sessionReference !== input.checkoutReference
    || input.snapshot.organizationId !== input.organizationId
    || input.snapshot.bookingId !== input.bookingId
    || input.snapshot.commercialAmendmentId !== input.amendmentId
    || input.snapshot.purpose !== CHECKOUT_PURPOSE
  ) {
    throw new StripeCommercialAmendmentRecoveryCheckoutConflictError('Stripe recovery Checkout ownership does not match the persisted amendment claim.');
  }
  if (
    input.amountMinor <= 0n
    || input.snapshot.money.currency !== input.currency
    || input.snapshot.money.amountMinor !== input.amountMinor
  ) {
    throw new StripeCommercialAmendmentRecoveryCheckoutConflictError('Stripe recovery Checkout money does not match the persisted amendment claim.');
  }
  if (
    input.snapshot.paymentIntentReference
    && (!PAYMENT_INTENT_PATTERN.test(input.snapshot.paymentIntentReference) || input.snapshot.paymentIntentReference.length > 160)
  ) {
    throw new StripeCommercialAmendmentRecoveryCheckoutConflictError('Stripe recovery Checkout PaymentIntent reference is invalid.');
  }

  if (input.snapshot.status === 'complete' && input.snapshot.paymentStatus === 'paid') {
    if (!input.snapshot.paymentIntentReference) {
      throw new StripeCommercialAmendmentRecoveryCheckoutConflictError('Paid Stripe recovery Checkout is missing its PaymentIntent reference.');
    }
    return Object.freeze({
      transactionStatus: 'SUCCEEDED',
      state: 'PAID',
      checkoutReference: input.checkoutReference,
      paymentIntentReference: input.snapshot.paymentIntentReference,
    });
  }

  if (
    input.snapshot.status === 'expired'
    && input.snapshot.paymentStatus === 'unpaid'
    && !input.snapshot.paymentIntentReference
  ) {
    return Object.freeze({
      transactionStatus: 'FAILED',
      state: 'EXPIRED',
      checkoutReference: input.checkoutReference,
      paymentIntentReference: null,
    });
  }

  if (input.snapshot.paymentStatus === 'no_payment_required') {
    throw new StripeCommercialAmendmentRecoveryCheckoutConflictError('Positive Stripe recovery Checkout cannot require no payment.');
  }
  if (input.snapshot.paymentStatus === 'paid' && input.snapshot.status !== 'complete') {
    throw new StripeCommercialAmendmentRecoveryCheckoutConflictError('Paid Stripe recovery Checkout is not complete.');
  }

  return Object.freeze({
    transactionStatus: 'AMBIGUOUS',
    state: 'WAIT_FOR_PROVIDER',
    checkoutReference: input.checkoutReference,
    paymentIntentReference: input.snapshot.paymentIntentReference,
  });
}
