import { createHash } from 'node:crypto';

const STRIPE_PROVIDER_CODE = 'stripe';
const INTERNAL_CLAIM_PREFIX = 'sf_claim_';

export type StripeCommercialAmendmentRefundDecision = Readonly<{
  state: 'EXECUTE';
  operation: 'REFUND';
  providerCode: 'manual' | 'stripe';
  sourceProviderReference: string;
  sourceKind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE';
  currency: string;
  amountMinor: bigint;
}>;

export type StripeCommercialAmendmentRefundClaim = Readonly<{
  providerCode: 'stripe';
  kind: 'REFUND';
  currency: string;
  amountMinor: bigint;
  sourceProviderReference: string;
  requestFingerprint: string;
  claimReference: string;
}>;

export type StripeCommercialAmendmentRefundTransactionStatus = 'PENDING' | 'AMBIGUOUS' | 'SUCCEEDED' | 'FAILED';
export type StripeCommercialAmendmentRefundProviderStatus = 'AMBIGUOUS' | 'SUCCEEDED' | 'FAILED';

export type StripeCommercialAmendmentRefundLifecycleDecision = Readonly<
  | {
      action: 'MUTATE';
      nextStatus: StripeCommercialAmendmentRefundProviderStatus;
      processingNote: 'commercial-amendment-refund-lifecycle-reconciled';
    }
  | {
      action: 'KEEP';
      nextStatus: StripeCommercialAmendmentRefundTransactionStatus;
      processingNote: 'commercial-amendment-refund-lifecycle-unchanged';
    }
>;

export function stripeCommercialAmendmentRefundFingerprint(input: {
  bookingId: string;
  amendmentId: string;
  currency: string;
  amountMinor: bigint;
  sourceProviderReference: string;
}): string {
  if (!/^pi_[A-Za-z0-9_]+$/.test(input.sourceProviderReference)) {
    throw new Error('Stripe commercial amendment refund source is invalid.');
  }
  if (!/^[A-Z]{3}$/.test(input.currency) || input.amountMinor <= 0n) {
    throw new Error('Stripe commercial amendment refund money is invalid.');
  }
  return createHash('sha256').update([
    'commercial-amendment',
    STRIPE_PROVIDER_CODE,
    'refund',
    input.bookingId,
    input.amendmentId,
    input.currency,
    input.amountMinor.toString(),
    input.sourceProviderReference,
  ].join('\u001f'), 'utf8').digest('hex');
}

export function deriveStripeCommercialAmendmentRefundClaim(input: {
  bookingId: string;
  amendmentId: string;
  decision: StripeCommercialAmendmentRefundDecision;
}): StripeCommercialAmendmentRefundClaim {
  if (input.decision.providerCode !== STRIPE_PROVIDER_CODE) {
    throw new Error('Commercial amendment refund is not assigned to Stripe.');
  }
  if (input.decision.sourceKind !== 'AUTHORIZATION' && input.decision.sourceKind !== 'CAPTURE') {
    throw new Error('Stripe commercial amendment refund requires a Stripe settlement source.');
  }
  const requestFingerprint = stripeCommercialAmendmentRefundFingerprint({
    bookingId: input.bookingId,
    amendmentId: input.amendmentId,
    currency: input.decision.currency,
    amountMinor: input.decision.amountMinor,
    sourceProviderReference: input.decision.sourceProviderReference,
  });

  return Object.freeze({
    providerCode: STRIPE_PROVIDER_CODE,
    kind: 'REFUND',
    currency: input.decision.currency,
    amountMinor: input.decision.amountMinor,
    sourceProviderReference: input.decision.sourceProviderReference,
    requestFingerprint,
    claimReference: `${INTERNAL_CLAIM_PREFIX}${requestFingerprint}`,
  });
}

export function stripeCommercialAmendmentRefundPersistenceStatus(
  providerStatus: 'REFUNDED' | 'PENDING' | 'FAILED',
): 'SUCCEEDED' | 'AMBIGUOUS' | 'FAILED' {
  if (providerStatus === 'REFUNDED') return 'SUCCEEDED';
  if (providerStatus === 'PENDING') return 'AMBIGUOUS';
  return 'FAILED';
}

export function reconcileStripeCommercialAmendmentRefundSnapshot(input: {
  currency: string;
  amountMinor: bigint;
  sourceProviderReference: string;
  snapshot: Readonly<{
    paymentIntentReference: string;
    status: string;
    currency: string;
    amountMinor: bigint;
  }>;
}): StripeCommercialAmendmentRefundProviderStatus {
  if (
    input.snapshot.currency !== input.currency
    || input.snapshot.amountMinor !== input.amountMinor
    || input.snapshot.paymentIntentReference !== input.sourceProviderReference
  ) {
    throw new Error('Stripe commercial amendment refund provider truth does not match the persisted claim.');
  }
  if (input.snapshot.status === 'succeeded') return 'SUCCEEDED';
  if (input.snapshot.status === 'failed' || input.snapshot.status === 'canceled') return 'FAILED';
  return 'AMBIGUOUS';
}

export function decideStripeCommercialAmendmentRefundLifecycleMutation(input: {
  currentStatus: StripeCommercialAmendmentRefundTransactionStatus;
  providerStatus: StripeCommercialAmendmentRefundProviderStatus;
}): StripeCommercialAmendmentRefundLifecycleDecision {
  if (input.currentStatus === input.providerStatus) {
    return Object.freeze({
      action: 'KEEP',
      nextStatus: input.currentStatus,
      processingNote: 'commercial-amendment-refund-lifecycle-unchanged',
    });
  }
  return Object.freeze({
    action: 'MUTATE',
    nextStatus: input.providerStatus,
    processingNote: 'commercial-amendment-refund-lifecycle-reconciled',
  });
}
