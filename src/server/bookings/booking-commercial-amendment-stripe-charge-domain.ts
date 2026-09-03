import { createHash } from 'node:crypto';

const STRIPE_PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;

export type StripeCommercialAmendmentChargeStage = 'AUTHORIZATION' | 'CAPTURE';

export type StripeCommercialAmendmentChargeSnapshot = Readonly<{
  providerReference: string;
  status: string;
  currency: string;
  amountMinor: bigint;
  amountReceivedMinor: bigint;
  amountCapturableMinor: bigint;
}>;

export type StripeCommercialAmendmentChargePersistence = Readonly<{
  transactionStatus: 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  directlySettled: boolean;
}>;

export function stripeCommercialAmendmentChargeOperationKey(input: {
  rootIdempotencyKey: string;
  bookingId: string;
  amendmentId: string;
  stage: StripeCommercialAmendmentChargeStage;
}) {
  const digest = createHash('sha256')
    .update([
      'stripe-commercial-amendment-charge',
      input.rootIdempotencyKey,
      input.bookingId,
      input.amendmentId,
      input.stage,
    ].join('\u001f'), 'utf8')
    .digest('hex');
  return `ca-stripe-${input.stage === 'AUTHORIZATION' ? 'auth' : 'capture'}-${digest}`;
}

export function stripeCommercialAmendmentChargeFingerprint(input: {
  bookingId: string;
  amendmentId: string;
  stage: StripeCommercialAmendmentChargeStage;
  currency: string;
  amountMinor: bigint;
  paymentMethodReference?: string | null;
  providerReference?: string | null;
}) {
  return createHash('sha256')
    .update([
      'stripe-commercial-amendment-charge',
      input.bookingId,
      input.amendmentId,
      input.stage,
      input.currency,
      input.amountMinor.toString(),
      input.paymentMethodReference ?? '',
      input.providerReference ?? '',
    ].join('\u001f'), 'utf8')
    .digest('hex');
}

export function stripeCommercialAmendmentChargePersistenceStatus(input: {
  stage: StripeCommercialAmendmentChargeStage;
  providerStatus: string;
}): StripeCommercialAmendmentChargePersistence {
  if (input.stage === 'AUTHORIZATION') {
    if (input.providerStatus === 'AUTHORIZED') {
      return Object.freeze({ transactionStatus: 'SUCCEEDED', directlySettled: false });
    }
    if (input.providerStatus === 'PAID') {
      return Object.freeze({ transactionStatus: 'SUCCEEDED', directlySettled: true });
    }
    if (input.providerStatus === 'FAILED') {
      return Object.freeze({ transactionStatus: 'FAILED', directlySettled: false });
    }
    if (input.providerStatus === 'PENDING') {
      return Object.freeze({ transactionStatus: 'AMBIGUOUS', directlySettled: false });
    }
    throw new Error(`Unsupported Stripe authorization state ${input.providerStatus.toLowerCase()}.`);
  }

  if (input.providerStatus === 'PAID') {
    return Object.freeze({ transactionStatus: 'SUCCEEDED', directlySettled: true });
  }
  if (input.providerStatus === 'FAILED') {
    return Object.freeze({ transactionStatus: 'FAILED', directlySettled: false });
  }
  if (input.providerStatus === 'PENDING') {
    return Object.freeze({ transactionStatus: 'AMBIGUOUS', directlySettled: false });
  }
  throw new Error(`Unsupported Stripe capture state ${input.providerStatus.toLowerCase()}.`);
}

export function reconcileStripeCommercialAmendmentChargeSnapshot(input: {
  stage: StripeCommercialAmendmentChargeStage;
  currency: string;
  amountMinor: bigint;
  providerReference: string;
  snapshot: StripeCommercialAmendmentChargeSnapshot;
}): StripeCommercialAmendmentChargePersistence {
  if (!STRIPE_PAYMENT_INTENT_PATTERN.test(input.providerReference)) {
    throw new Error('Commercial amendment Stripe PaymentIntent reference is invalid.');
  }
  if (input.snapshot.providerReference !== input.providerReference) {
    throw new Error('Stripe reconciliation returned a different PaymentIntent reference.');
  }
  if (input.snapshot.currency !== input.currency || input.snapshot.amountMinor !== input.amountMinor) {
    throw new Error('Stripe reconciliation money does not match the commercial amendment charge.');
  }

  if (input.stage === 'AUTHORIZATION') {
    if (input.snapshot.status === 'requires_capture') {
      if (input.snapshot.amountCapturableMinor !== input.amountMinor) {
        throw new Error('Stripe capturable amount does not match the commercial amendment charge.');
      }
      return Object.freeze({ transactionStatus: 'SUCCEEDED', directlySettled: false });
    }
    if (input.snapshot.status === 'succeeded') {
      if (input.snapshot.amountReceivedMinor !== input.amountMinor) {
        throw new Error('Stripe settled amount does not match the commercial amendment charge.');
      }
      return Object.freeze({ transactionStatus: 'SUCCEEDED', directlySettled: true });
    }
    if (input.snapshot.status === 'canceled' || input.snapshot.status === 'requires_payment_method') {
      return Object.freeze({ transactionStatus: 'FAILED', directlySettled: false });
    }
    return Object.freeze({ transactionStatus: 'AMBIGUOUS', directlySettled: false });
  }

  if (input.snapshot.status === 'succeeded') {
    if (input.snapshot.amountReceivedMinor !== input.amountMinor) {
      throw new Error('Stripe captured amount does not match the commercial amendment charge.');
    }
    return Object.freeze({ transactionStatus: 'SUCCEEDED', directlySettled: true });
  }
  if (input.snapshot.status === 'canceled' || input.snapshot.status === 'requires_payment_method') {
    return Object.freeze({ transactionStatus: 'FAILED', directlySettled: false });
  }
  return Object.freeze({ transactionStatus: 'AMBIGUOUS', directlySettled: false });
}

export function stripeCommercialAmendmentDirectCaptureIdempotencyKey(input: {
  bookingId: string;
  amendmentId: string;
  providerReference: string;
}) {
  const digest = createHash('sha256')
    .update(['stripe-commercial-amendment-direct-capture', input.bookingId, input.amendmentId, input.providerReference].join('\u001f'), 'utf8')
    .digest('hex');
  return `ca-stripe-direct-capture-${digest}`;
}
