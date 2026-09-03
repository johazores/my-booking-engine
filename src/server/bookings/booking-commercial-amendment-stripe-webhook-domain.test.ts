import assert from 'node:assert/strict';
import test from 'node:test';

const {
  selectStripeCommercialAmendmentPaymentWebhookCandidate,
  selectStripeCommercialAmendmentRefundWebhookCandidate,
} = await import('./booking-commercial-amendment-stripe-webhook-domain.ts');

const amendmentId = '33333333-3333-4333-8333-333333333333';
const bookingId = '22222222-2222-4222-8222-222222222222';

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    bookingId,
    commercialAmendmentId: amendmentId,
    kind: 'AUTHORIZATION' as const,
    providerReference: 'pi_charge_1',
    currency: 'USD',
    amountMinor: 2500n,
    ...overrides,
  };
}

function refund(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refund-1',
    bookingId,
    commercialAmendmentId: amendmentId,
    providerReference: 're_refund_1',
    sourceProviderReference: 'pi_source_1',
    currency: 'USD',
    amountMinor: 2500n,
    ...overrides,
  };
}

test('commercial amendment payment webhook selects one exact persisted PaymentIntent reference', () => {
  const selected = selectStripeCommercialAmendmentPaymentWebhookCandidate({
    providerReference: 'pi_charge_1',
    currency: 'USD',
    amountMinor: 2500n,
    candidates: [payment()],
  });
  assert.equal(selected?.id, 'payment-1');
});

test('commercial amendment payment webhook does not guess an internal pre-reference claim', () => {
  const selected = selectStripeCommercialAmendmentPaymentWebhookCandidate({
    providerReference: 'pi_charge_provider',
    currency: 'USD',
    amountMinor: 2500n,
    candidates: [payment({ providerReference: `sf_claim_${'a'.repeat(64)}` })],
  });
  assert.equal(selected, null);
});

test('commercial amendment payment webhook fails closed on exact money drift and duplicate reference ownership', () => {
  assert.throws(() => selectStripeCommercialAmendmentPaymentWebhookCandidate({
    providerReference: 'pi_charge_1',
    currency: 'USD',
    amountMinor: 2500n,
    candidates: [payment({ amountMinor: 2400n })],
  }), /money does not match/i);

  assert.throws(() => selectStripeCommercialAmendmentPaymentWebhookCandidate({
    providerReference: 'pi_charge_1',
    currency: 'USD',
    amountMinor: 2500n,
    candidates: [payment(), payment({ id: 'payment-2', kind: 'CAPTURE' })],
  }), /multiple commercial amendment charge/i);
});

test('commercial amendment payment webhook ignores a different provider reference', () => {
  const selected = selectStripeCommercialAmendmentPaymentWebhookCandidate({
    providerReference: 'pi_charge_other',
    currency: 'USD',
    amountMinor: 2500n,
    candidates: [payment()],
  });
  assert.equal(selected, null);
});

test('commercial amendment refund webhook selects one exact persisted refund reference with exact source money', () => {
  const selected = selectStripeCommercialAmendmentRefundWebhookCandidate({
    refundReference: 're_refund_1',
    paymentIntentReference: 'pi_source_1',
    currency: 'USD',
    amountMinor: 2500n,
    candidates: [refund()],
  });
  assert.equal(selected?.id, 'refund-1');
});

test('commercial amendment refund webhook does not guess an internal pre-reference claim', () => {
  const selected = selectStripeCommercialAmendmentRefundWebhookCandidate({
    refundReference: 're_provider_refund',
    paymentIntentReference: 'pi_source_1',
    currency: 'USD',
    amountMinor: 2500n,
    candidates: [refund({ providerReference: `sf_claim_${'b'.repeat(64)}` })],
  });
  assert.equal(selected, null);
});

test('commercial amendment refund webhook fails closed on source or money drift and duplicate reference ownership', () => {
  assert.throws(() => selectStripeCommercialAmendmentRefundWebhookCandidate({
    refundReference: 're_refund_1',
    paymentIntentReference: 'pi_source_other',
    currency: 'USD',
    amountMinor: 2500n,
    candidates: [refund()],
  }), /source and money/i);

  assert.throws(() => selectStripeCommercialAmendmentRefundWebhookCandidate({
    refundReference: 're_refund_1',
    paymentIntentReference: 'pi_source_1',
    currency: 'USD',
    amountMinor: 2500n,
    candidates: [refund(), refund({ id: 'refund-2' })],
  }), /multiple commercial amendment refund/i);
});

test('commercial amendment refund webhook ignores a different refund reference', () => {
  const selected = selectStripeCommercialAmendmentRefundWebhookCandidate({
    refundReference: 're_refund_other',
    paymentIntentReference: 'pi_source_1',
    currency: 'USD',
    amountMinor: 2500n,
    candidates: [refund()],
  });
  assert.equal(selected, null);
});
