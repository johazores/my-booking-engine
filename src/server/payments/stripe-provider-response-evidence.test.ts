import assert from 'node:assert/strict';
import test from 'node:test';

import { PaymentProviderError } from './payment-provider.ts';
import {
  assertStripeProviderResponseObject,
  normalizeStripeProviderResponseCurrency,
  normalizeStripeProviderResponseMoney,
  readStripeProviderError,
} from './stripe-provider-response-evidence.ts';

const unknownProviderEvidence = (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable;

test('Stripe provider response money accepts exact supported lowercase currency', () => {
  assert.deepEqual(normalizeStripeProviderResponseMoney('usd', 4100n), { currency: 'USD', amountMinor: 4100n });
  assert.equal(normalizeStripeProviderResponseCurrency('aud'), 'AUD');
});

test('Stripe provider response money rejects malformed, fabricated, and caller-style currencies as retryable unknown truth', () => {
  for (const currency of [undefined, null, 123, '', 'zzz', 'USD', ' usd ', 'usd\n', 'u$d']) {
    assert.throws(() => normalizeStripeProviderResponseMoney(currency, 4100n), unknownProviderEvidence);
    assert.throws(() => normalizeStripeProviderResponseCurrency(currency), unknownProviderEvidence);
  }
  assert.throws(() => normalizeStripeProviderResponseMoney('usd', -1n), unknownProviderEvidence);
});

test('Stripe provider response object authority rejects successful scalar and array JSON', () => {
  for (const value of [null, [], 123, true, 'not-a-session']) {
    assert.throws(() => assertStripeProviderResponseObject(value), unknownProviderEvidence);
  }
  assert.doesNotThrow(() => assertStripeProviderResponseObject({ id: 'cs_test_1' }));
});

test('Stripe error extraction preserves HTTP classification on malformed payloads and bounds diagnostics', () => {
  for (const payload of [null, [], { error: null }, { error: { message: 7 } }, { error: { message: '\nunsafe\r' } }, { error: { message: 'x'.repeat(513) } }]) {
    assert.equal(readStripeProviderError(payload, 'Fallback').message, 'Fallback');
  }
  assert.deepEqual(readStripeProviderError({ error: {
    message: 'Card declined', type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds',
  } }, 'Fallback'), {
    message: 'Card declined', type: 'card_error', code: 'card_declined', declineCode: 'insufficient_funds',
  });
});
