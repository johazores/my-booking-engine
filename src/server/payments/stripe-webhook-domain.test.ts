import assert from 'node:assert/strict';
import test from 'node:test';

const {
  StripeWebhookValidationError,
  parseStripeWebhookEventPayload,
  selectStripeWebhookPaymentCandidate,
  selectStripeWebhookRefundCandidate,
} = await import('./stripe-webhook-domain.ts');

const organizationId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';

function paymentIntentEvent(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'evt_sf_payment_1',
    type: 'payment_intent.amount_capturable_updated',
    created: 1788250000,
    data: {
      object: {
        id: 'pi_sf_payment_1',
        status: 'requires_capture',
        amount: 12500,
        amount_received: 0,
        currency: 'usd',
        metadata: {
          sf_organization_id: organizationId,
          sf_booking_id: bookingId,
        },
        ...overrides,
      },
    },
  });
}

function refundEvent(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'evt_sf_refund_1',
    type: 'refund.updated',
    created: 1788250001,
    data: {
      object: {
        id: 're_sf_refund_1',
        payment_intent: 'pi_sf_payment_1',
        status: 'succeeded',
        amount: 2500,
        currency: 'usd',
        ...overrides,
      },
    },
  });
}

test('Stripe webhook parser normalizes signed-payment fields without trusting provider-specific objects elsewhere', () => {
  const event = parseStripeWebhookEventPayload(paymentIntentEvent());
  assert.equal(event.providerEventId, 'evt_sf_payment_1');
  assert.equal(event.eventType, 'payment_intent.amount_capturable_updated');
  assert.equal(event.paymentIntent?.providerReference, 'pi_sf_payment_1');
  assert.equal(event.paymentIntent?.currency, 'USD');
  assert.equal(event.paymentIntent?.amountMinor, 12500n);
  assert.equal(event.paymentIntent?.organizationId, organizationId);
  assert.equal(event.paymentIntent?.bookingId, bookingId);
  assert.equal(event.refund, null);
});

test('Stripe webhook parser normalizes refund objects with their source PaymentIntent and exact money', () => {
  const event = parseStripeWebhookEventPayload(refundEvent());
  assert.equal(event.providerEventId, 'evt_sf_refund_1');
  assert.equal(event.eventType, 'refund.updated');
  assert.equal(event.paymentIntent, null);
  assert.equal(event.refund?.refundReference, 're_sf_refund_1');
  assert.equal(event.refund?.paymentIntentReference, 'pi_sf_payment_1');
  assert.equal(event.refund?.status, 'succeeded');
  assert.equal(event.refund?.currency, 'USD');
  assert.equal(event.refund?.amountMinor, 2500n);
});

test('Stripe webhook parser safely ignores unsupported event bodies after envelope validation', () => {
  const event = parseStripeWebhookEventPayload(JSON.stringify({
    id: 'evt_customer_1',
    type: 'customer.created',
    created: 1788250000,
    data: { object: { id: 'cus_123' } },
  }));
  assert.equal(event.paymentIntent, null);
  assert.equal(event.refund, null);
});

test('Stripe webhook parser rejects malformed payment and refund money and invalid tenant metadata', () => {
  assert.throws(() => parseStripeWebhookEventPayload(paymentIntentEvent({ amount: 12.5 })), StripeWebhookValidationError);
  assert.throws(() => parseStripeWebhookEventPayload(paymentIntentEvent({ amount: 100, amount_received: 101 })), StripeWebhookValidationError);
  assert.throws(() => parseStripeWebhookEventPayload(refundEvent({ amount: 0 })), StripeWebhookValidationError);
  assert.throws(() => parseStripeWebhookEventPayload(refundEvent({ payment_intent: 'not-a-payment-intent' })), StripeWebhookValidationError);

  const event = parseStripeWebhookEventPayload(paymentIntentEvent({
    metadata: { sf_organization_id: 'not-a-uuid', sf_booking_id: bookingId },
  }));
  assert.equal(event.paymentIntent?.organizationId, null);
  assert.equal(event.paymentIntent?.bookingId, bookingId);
});

test('webhook candidate selection prefers exact provider references and capture on succeeded events', () => {
  const selected = selectStripeWebhookPaymentCandidate({
    providerReference: 'pi_sf_payment_1',
    providerStatus: 'succeeded',
    candidates: [
      { id: 'auth', kind: 'AUTHORIZATION', providerReference: 'pi_sf_payment_1' },
      { id: 'capture', kind: 'CAPTURE', providerReference: 'pi_sf_payment_1' },
      { id: 'claim', kind: 'CAPTURE', providerReference: `sf_claim_${'a'.repeat(64)}` },
    ],
    isInternalReference: (reference) => reference.startsWith('sf_claim_'),
  });
  assert.equal(selected?.id, 'capture');
});

test('webhook candidate selection resolves a pre-reference authorization claim and rejects ambiguity', () => {
  const selected = selectStripeWebhookPaymentCandidate({
    providerReference: 'pi_sf_payment_2',
    providerStatus: 'requires_capture',
    candidates: [{ id: 'auth-claim', kind: 'AUTHORIZATION', providerReference: `sf_claim_${'b'.repeat(64)}` }],
    isInternalReference: (reference) => reference.startsWith('sf_claim_'),
  });
  assert.equal(selected?.id, 'auth-claim');

  assert.throws(() => selectStripeWebhookPaymentCandidate({
    providerReference: 'pi_sf_payment_3',
    providerStatus: 'requires_capture',
    candidates: [
      { id: 'auth-1', kind: 'AUTHORIZATION', providerReference: `sf_claim_${'c'.repeat(64)}` },
      { id: 'auth-2', kind: 'AUTHORIZATION', providerReference: `sf_claim_${'d'.repeat(64)}` },
    ],
    isInternalReference: (reference) => reference.startsWith('sf_claim_'),
  }), /multiple pending/i);
});

test('refund webhook candidate selection prefers an exact refund reference', () => {
  const selected = selectStripeWebhookRefundCandidate({
    refundReference: 're_sf_refund_1',
    currency: 'USD',
    amountMinor: 2500n,
    candidates: [
      { id: 'claim', providerReference: `sf_claim_${'e'.repeat(64)}`, currency: 'USD', amountMinor: 2500n },
      { id: 'exact', providerReference: 're_sf_refund_1', currency: 'USD', amountMinor: 2500n },
    ],
    isInternalReference: (reference) => reference.startsWith('sf_claim_'),
  });
  assert.equal(selected?.id, 'exact');
});

test('refund webhook candidate selection binds one matching internal claim and rejects ambiguous claims', () => {
  const claim = `sf_claim_${'f'.repeat(64)}`;
  const selected = selectStripeWebhookRefundCandidate({
    refundReference: 're_sf_refund_2',
    currency: 'USD',
    amountMinor: 2500n,
    candidates: [{ id: 'claim', providerReference: claim, currency: 'USD', amountMinor: 2500n }],
    isInternalReference: (reference) => reference.startsWith('sf_claim_'),
  });
  assert.equal(selected?.id, 'claim');

  assert.throws(() => selectStripeWebhookRefundCandidate({
    refundReference: 're_sf_refund_3',
    currency: 'USD',
    amountMinor: 2500n,
    candidates: [
      { id: 'claim-1', providerReference: `sf_claim_${'1'.repeat(64)}`, currency: 'USD', amountMinor: 2500n },
      { id: 'claim-2', providerReference: `sf_claim_${'2'.repeat(64)}`, currency: 'USD', amountMinor: 2500n },
    ],
    isInternalReference: (reference) => reference.startsWith('sf_claim_'),
  }), /multiple pending refund/i);
});

test('refund webhook candidate selection rejects money mismatch on an exact provider reference', () => {
  assert.throws(() => selectStripeWebhookRefundCandidate({
    refundReference: 're_sf_refund_4',
    currency: 'USD',
    amountMinor: 2500n,
    candidates: [{ id: 'exact', providerReference: 're_sf_refund_4', currency: 'USD', amountMinor: 2400n }],
    isInternalReference: (reference) => reference.startsWith('sf_claim_'),
  }), /money does not match/i);
});
