import assert from 'node:assert/strict';
import test from 'node:test';

import { StripeWebhookValidationError } from './stripe-webhook-domain.ts';
import { decideStripeWebhookPaymentMutation } from './stripe-webhook-payment-mutation-domain.ts';

const internal = (value: string) => value.startsWith('sf_claim_');
const claim = (suffix: string) => `sf_claim_${suffix.repeat(64).slice(0, 64)}`;

function candidate(input: {
  id: string;
  kind?: 'AUTHORIZATION' | 'CAPTURE';
  status?: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  providerReference?: string;
  commercialAmendmentId?: string | null;
}) {
  return {
    id: input.id,
    kind: input.kind ?? 'AUTHORIZATION',
    status: input.status ?? 'PENDING',
    providerReference: input.providerReference ?? claim(input.id[0] ?? 'a'),
    commercialAmendmentId: input.commercialAmendmentId ?? null,
  } as const;
}

test('exact historical provider identity outranks a newer pre-reference claim', () => {
  const exact = candidate({
    id: 'old',
    status: 'FAILED',
    providerReference: 'pi_old_attempt',
  });
  const newer = candidate({ id: 'new', providerReference: claim('b') });

  const decision = decideStripeWebhookPaymentMutation({
    providerReference: 'pi_old_attempt',
    providerStatus: 'succeeded',
    exactCandidates: [exact],
    pendingCandidates: [newer],
    isInternalReference: internal,
  });

  assert.equal(decision.action, 'MUTATE');
  if (decision.action === 'MUTATE') {
    assert.equal(decision.candidate.id, 'old');
    assert.equal(decision.candidate.status, 'FAILED');
  }
});

test('positive Stripe truth can recover the exact failed PaymentIntent operation', () => {
  for (const [providerStatus, kind] of [
    ['requires_capture', 'AUTHORIZATION'],
    ['succeeded', 'CAPTURE'],
  ] as const) {
    const decision = decideStripeWebhookPaymentMutation({
      providerReference: 'pi_recovered',
      providerStatus,
      exactCandidates: [candidate({ id: kind, kind, status: 'FAILED', providerReference: 'pi_recovered' })],
      pendingCandidates: [],
      isInternalReference: internal,
    });
    assert.equal(decision.action, 'MUTATE');
    if (decision.action === 'MUTATE') assert.equal(decision.candidate.status, 'FAILED');
  }
});

test('stale failure cannot regress an exact failed or successful operation', () => {
  const failed = decideStripeWebhookPaymentMutation({
    providerReference: 'pi_failed',
    providerStatus: 'requires_payment_method',
    exactCandidates: [candidate({ id: 'failed', status: 'FAILED', providerReference: 'pi_failed' })],
    pendingCandidates: [],
    isInternalReference: internal,
  });
  assert.deepEqual(failed, { action: 'IGNORE', processingNote: 'payment-failure-already-recorded' });

  const succeeded = decideStripeWebhookPaymentMutation({
    providerReference: 'pi_succeeded',
    providerStatus: 'requires_payment_method',
    exactCandidates: [candidate({ id: 'success', status: 'SUCCEEDED', providerReference: 'pi_succeeded' })],
    pendingCandidates: [],
    isInternalReference: internal,
  });
  assert.deepEqual(succeeded, { action: 'IGNORE', processingNote: 'payment-already-settled' });
});

test('specialized commercial-amendment ownership blocks the generic payment state machine', () => {
  const decision = decideStripeWebhookPaymentMutation({
    providerReference: 'pi_amendment',
    providerStatus: 'succeeded',
    exactCandidates: [candidate({
      id: 'amendment',
      kind: 'CAPTURE',
      status: 'AMBIGUOUS',
      providerReference: 'pi_amendment',
      commercialAmendmentId: '33333333-3333-4333-8333-333333333333',
    })],
    pendingCandidates: [],
    isInternalReference: internal,
  });
  assert.deepEqual(decision, { action: 'IGNORE', processingNote: 'payment-specialized-flow-owned' });
});

test('exact provider ownership never falls through to an incompatible newer claim', () => {
  const decision = decideStripeWebhookPaymentMutation({
    providerReference: 'pi_capture_only',
    providerStatus: 'requires_capture',
    exactCandidates: [candidate({
      id: 'capture',
      kind: 'CAPTURE',
      status: 'FAILED',
      providerReference: 'pi_capture_only',
    })],
    pendingCandidates: [candidate({ id: 'new-auth', providerReference: claim('c') })],
    isInternalReference: internal,
  });
  assert.deepEqual(decision, {
    action: 'IGNORE',
    processingNote: 'payment-provider-reference-owned-by-incompatible-operation',
  });
});

test('without exact provider ownership one unambiguous normal pending claim can still bind', () => {
  const pending = candidate({ id: 'pending', providerReference: claim('d') });
  const decision = decideStripeWebhookPaymentMutation({
    providerReference: 'pi_first_seen',
    providerStatus: 'requires_capture',
    exactCandidates: [],
    pendingCandidates: [pending],
    isInternalReference: internal,
  });
  assert.equal(decision.action, 'MUTATE');
  if (decision.action === 'MUTATE') assert.equal(decision.candidate.id, pending.id);
});

test('candidate contract fails closed on mismatched exact-reference or specialized pending state', () => {
  assert.throws(() => decideStripeWebhookPaymentMutation({
    providerReference: 'pi_expected',
    providerStatus: 'succeeded',
    exactCandidates: [candidate({ id: 'wrong', providerReference: 'pi_other' })],
    pendingCandidates: [],
    isInternalReference: internal,
  }), StripeWebhookValidationError);

  assert.throws(() => decideStripeWebhookPaymentMutation({
    providerReference: 'pi_new',
    providerStatus: 'succeeded',
    exactCandidates: [],
    pendingCandidates: [candidate({
      id: 'specialized',
      commercialAmendmentId: '33333333-3333-4333-8333-333333333333',
    })],
    isInternalReference: internal,
  }), StripeWebhookValidationError);
});
