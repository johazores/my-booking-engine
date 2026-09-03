import { createHash } from 'node:crypto';

const STRIPE_PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const STRIPE_REFUND_PATTERN = /^re_[A-Za-z0-9_]+$/;

export type StripeCommercialAmendmentRecoveryOperation =
  | 'RELEASE_AUTHORIZATION'
  | 'CAPTURE_COMPENSATION'
  | 'COMPENSATION_REFUND';

export type StripeCommercialAmendmentRecoveryAuthorizationState =
  | Readonly<{ state: 'RELEASE_REQUIRED' }>
  | Readonly<{ state: 'RELEASED' }>
  | Readonly<{ state: 'SETTLED' }>
  | Readonly<{ state: 'WAIT_FOR_PROVIDER'; providerStatus: string }>;

function operationLabel(operation: StripeCommercialAmendmentRecoveryOperation) {
  if (operation === 'RELEASE_AUTHORIZATION') return 'release';
  if (operation === 'CAPTURE_COMPENSATION') return 'capture';
  return 'refund';
}

function assertRecoveryMoney(input: { currency: string; amountMinor: bigint }) {
  if (!/^[A-Z]{3}$/.test(input.currency) || input.amountMinor <= 0n) {
    throw new Error('Stripe commercial amendment recovery money is invalid.');
  }
}

function assertPaymentIntentReference(reference: string) {
  if (!STRIPE_PAYMENT_INTENT_PATTERN.test(reference)) {
    throw new Error('Stripe commercial amendment recovery PaymentIntent reference is invalid.');
  }
}

export function stripeCommercialAmendmentRecoveryOperationKey(input: {
  bookingId: string;
  amendmentId: string;
  operation: StripeCommercialAmendmentRecoveryOperation;
  providerReference: string;
}) {
  assertPaymentIntentReference(input.providerReference);
  const digest = createHash('sha256').update([
    'stripe-commercial-amendment-recovery',
    input.bookingId,
    input.amendmentId,
    input.operation,
    input.providerReference,
  ].join('\u001f'), 'utf8').digest('hex');
  return `ca-stripe-recovery-${operationLabel(input.operation)}-${digest}`;
}

export function stripeCommercialAmendmentRecoveryFingerprint(input: {
  bookingId: string;
  amendmentId: string;
  operation: StripeCommercialAmendmentRecoveryOperation;
  currency: string;
  amountMinor: bigint;
  providerReference: string;
}) {
  assertPaymentIntentReference(input.providerReference);
  assertRecoveryMoney(input);
  return createHash('sha256').update([
    'stripe-commercial-amendment-recovery',
    input.bookingId,
    input.amendmentId,
    input.operation,
    input.currency,
    input.amountMinor.toString(),
    input.providerReference,
  ].join('\u001f'), 'utf8').digest('hex');
}

export function stripeCommercialAmendmentRecoveryClaimReference(fingerprint: string) {
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw new Error('Stripe commercial amendment recovery fingerprint is invalid.');
  }
  return `sf_claim_${fingerprint}`;
}

export function reconcileStripeCommercialAmendmentRecoveryAuthorization(input: {
  providerReference: string;
  currency: string;
  amountMinor: bigint;
  snapshot: Readonly<{
    providerReference: string;
    status: string;
    currency: string;
    amountMinor: bigint;
    amountReceivedMinor: bigint;
    amountCapturableMinor: bigint;
  }>;
}): StripeCommercialAmendmentRecoveryAuthorizationState {
  assertPaymentIntentReference(input.providerReference);
  assertRecoveryMoney(input);
  if (
    input.snapshot.providerReference !== input.providerReference
    || input.snapshot.currency !== input.currency
    || input.snapshot.amountMinor !== input.amountMinor
  ) {
    throw new Error('Stripe commercial amendment recovery authorization provider truth does not match local evidence.');
  }

  if (input.snapshot.status === 'requires_capture') {
    if (input.snapshot.amountReceivedMinor !== 0n || input.snapshot.amountCapturableMinor !== input.amountMinor) {
      throw new Error('Stripe commercial amendment recovery authorization has unexpected capturable money.');
    }
    return Object.freeze({ state: 'RELEASE_REQUIRED' as const });
  }

  if (input.snapshot.status === 'canceled') {
    if (input.snapshot.amountReceivedMinor !== 0n || input.snapshot.amountCapturableMinor !== 0n) {
      throw new Error('Canceled Stripe commercial amendment authorization contains unexplained settled money.');
    }
    return Object.freeze({ state: 'RELEASED' as const });
  }

  if (input.snapshot.status === 'succeeded') {
    if (input.snapshot.amountReceivedMinor !== input.amountMinor || input.snapshot.amountCapturableMinor !== 0n) {
      throw new Error('Settled Stripe commercial amendment authorization does not match the authorized money.');
    }
    return Object.freeze({ state: 'SETTLED' as const });
  }

  return Object.freeze({ state: 'WAIT_FOR_PROVIDER' as const, providerStatus: input.snapshot.status });
}

export function assertStripeCommercialAmendmentRecoveryRefundReference(reference: string) {
  if (!STRIPE_REFUND_PATTERN.test(reference)) {
    throw new Error('Stripe commercial amendment recovery refund reference is invalid.');
  }
  return reference;
}
