import assert from 'node:assert/strict';
import test from 'node:test';

import { PaymentProviderError } from './payment-provider.ts';
import {
  assertStripeProviderResponseObject,
  classifyStripeLookupHttpError,
  classifyStripePaymentHttpError,
  isCanonicalStripeProviderCurrency,
  normalizeStripeProviderResponseCurrency,
  normalizeStripeProviderResponseMoney,
  readStripeProviderError,
} from './stripe-provider-response-evidence.ts';

const unknownProviderEvidence = (error: unknown) => error instanceof PaymentProviderError && error.code === 'UNKNOWN' && error.retryable;

test('Stripe provider response money accepts exact supported lowercase currency', () => {
  assert.deepEqual(normalizeStripeProviderResponseMoney('usd', 4100n), { currency: 'USD', amountMinor: 4100n });
  assert.equal(normalizeStripeProviderResponseCurrency('aud'), 'AUD');
  assert.equal(isCanonicalStripeProviderCurrency('php'), true);
});

test('Stripe provider response money rejects malformed, fabricated, and caller-style currencies as retryable unknown truth', () => {
  for (const currency of [undefined, null, 123, '', 'zzz', 'USD', ' usd ', 'usd\n', 'u$d']) {
    assert.equal(isCanonicalStripeProviderCurrency(currency), false);
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

test('Stripe HTTP payment error classification prioritizes transport status over misleading body hints', () => {
  const cases = [
    { status: 401, type: 'card_error', code: 'AUTHENTICATION_FAILED', retryable: false },
    { status: 408, type: 'idempotency_error', code: 'TIMEOUT', retryable: true },
    { status: 429, type: 'idempotency_error', code: 'RATE_LIMITED', retryable: true },
    { status: 503, type: 'card_error', code: 'PROVIDER_UNAVAILABLE', retryable: true },
    { status: 500, type: 'idempotency_error', code: 'PROVIDER_UNAVAILABLE', retryable: true },
    { status: 409, type: 'card_error', code: 'DUPLICATE', retryable: false },
    { status: 400, type: 'idempotency_error', code: 'DUPLICATE', retryable: false },
    { status: 402, type: 'card_error', code: 'DECLINED', retryable: false },
    { status: 400, type: null, code: 'INVALID_REQUEST', retryable: false },
  ] as const;
  for (const item of cases) {
    const error = classifyStripePaymentHttpError(item.status, { error: { type: item.type } }, 'Fallback');
    assert.equal(error instanceof PaymentProviderError, true);
    assert.equal(error.code, item.code, String(item.status));
    assert.equal(error.retryable, item.retryable, String(item.status));
  }
});

test('Stripe HTTP lookup classification keeps 404 and timeout semantics separate', () => {
  for (const item of [
    { status: 401, code: 'AUTHENTICATION_FAILED', retryable: false },
    { status: 404, code: 'INVALID_REQUEST', retryable: false },
    { status: 408, code: 'TIMEOUT', retryable: true },
    { status: 429, code: 'RATE_LIMITED', retryable: true },
    { status: 503, code: 'PROVIDER_UNAVAILABLE', retryable: true },
    { status: 400, code: 'INVALID_REQUEST', retryable: false },
  ] as const) {
    const error = classifyStripeLookupHttpError(item.status, { error: { type: 'card_error' } }, 'Fallback', 'Not found');
    assert.equal(error.code, item.code, String(item.status));
    assert.equal(error.retryable, item.retryable, String(item.status));
    if (item.status === 404) assert.equal(error.message, 'Not found');
  }
});
