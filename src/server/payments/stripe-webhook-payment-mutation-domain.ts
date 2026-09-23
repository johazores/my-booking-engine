import {
  StripeWebhookValidationError,
  selectStripeWebhookPaymentCandidate,
  type StripeWebhookPaymentCandidate,
} from './stripe-webhook-domain.ts';

export type StripeWebhookPersistedPaymentCandidate = Readonly<
  StripeWebhookPaymentCandidate & {
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
    commercialAmendmentId: string | null;
  }
>;

export type StripeWebhookPaymentMutationDecision = Readonly<
  | {
      action: 'MUTATE';
      candidate: StripeWebhookPersistedPaymentCandidate & { status: 'PENDING' | 'FAILED' };
    }
  | {
      action: 'IGNORE';
      processingNote:
        | 'payment-already-settled'
        | 'payment-failure-already-recorded'
        | 'payment-provider-reference-owned-by-incompatible-operation'
        | 'payment-specialized-flow-owned';
    }
  | { action: 'NO_MATCH' }
>;

function preferredKinds(providerStatus: string): readonly StripeWebhookPaymentCandidate['kind'][] {
  if (providerStatus === 'succeeded') return ['CAPTURE', 'AUTHORIZATION'];
  if (providerStatus === 'requires_capture') return ['AUTHORIZATION'];
  return ['AUTHORIZATION', 'CAPTURE'];
}

function selectExactCandidate(input: {
  providerReference: string;
  providerStatus: string;
  candidates: readonly StripeWebhookPersistedPaymentCandidate[];
}): StripeWebhookPersistedPaymentCandidate | null {
  const exact = input.candidates.filter((candidate) => candidate.providerReference === input.providerReference);
  if (exact.length !== input.candidates.length) {
    throw new StripeWebhookValidationError('Stripe webhook exact payment candidates are not provider-reference bound.');
  }

  for (const kind of preferredKinds(input.providerStatus)) {
    const matches = exact.filter((candidate) => candidate.kind === kind);
    if (matches.length > 1) {
      throw new StripeWebhookValidationError('Stripe webhook provider reference matches multiple payment operations.');
    }
    if (matches.length === 1) return matches[0];
  }
  return null;
}

/**
 * Resolves which persisted payment operation a signed PaymentIntent snapshot may
 * mutate. Exact provider-reference ownership always outranks pre-reference
 * claims so an older Stripe attempt can never be rebound onto a newer attempt.
 */
export function decideStripeWebhookPaymentMutation(input: {
  providerReference: string;
  providerStatus: string;
  exactCandidates: readonly StripeWebhookPersistedPaymentCandidate[];
  pendingCandidates: readonly StripeWebhookPersistedPaymentCandidate[];
  isInternalReference: (reference: string) => boolean;
}): StripeWebhookPaymentMutationDecision {
  if (input.exactCandidates.length > 0) {
    const selected = selectExactCandidate({
      providerReference: input.providerReference,
      providerStatus: input.providerStatus,
      candidates: input.exactCandidates,
    });
    if (!selected) {
      return Object.freeze({ action: 'IGNORE', processingNote: 'payment-provider-reference-owned-by-incompatible-operation' });
    }
    if (selected.commercialAmendmentId !== null || selected.status === 'AMBIGUOUS') {
      return Object.freeze({ action: 'IGNORE', processingNote: 'payment-specialized-flow-owned' });
    }
    if (selected.status === 'SUCCEEDED') {
      return Object.freeze({ action: 'IGNORE', processingNote: 'payment-already-settled' });
    }
    if (selected.status === 'FAILED') {
      if (input.providerStatus !== 'succeeded' && input.providerStatus !== 'requires_capture') {
        return Object.freeze({ action: 'IGNORE', processingNote: 'payment-failure-already-recorded' });
      }
      return Object.freeze({
        action: 'MUTATE',
        candidate: Object.freeze({ ...selected, status: 'FAILED' as const }),
      });
    }
    return Object.freeze({
      action: 'MUTATE',
      candidate: Object.freeze({ ...selected, status: 'PENDING' as const }),
    });
  }

  if (input.pendingCandidates.some((candidate) => candidate.status !== 'PENDING' || candidate.commercialAmendmentId !== null)) {
    throw new StripeWebhookValidationError('Stripe webhook pending payment candidates contain unsupported ownership state.');
  }

  const selected = selectStripeWebhookPaymentCandidate({
    providerReference: input.providerReference,
    providerStatus: input.providerStatus,
    candidates: input.pendingCandidates,
    isInternalReference: input.isInternalReference,
  });
  if (!selected) return Object.freeze({ action: 'NO_MATCH' });
  const candidate = input.pendingCandidates.find((entry) => entry.id === selected.id);
  if (!candidate || candidate.status !== 'PENDING' || candidate.commercialAmendmentId !== null) {
    throw new StripeWebhookValidationError('Stripe webhook selected payment candidate is no longer a normal pending operation.');
  }
  return Object.freeze({
    action: 'MUTATE',
    candidate: Object.freeze({ ...candidate, status: 'PENDING' as const }),
  });
}
