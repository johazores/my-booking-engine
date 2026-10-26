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
    { status: 409, type: 'card_error', code: 'UNKNOWN', retryable: true },
    { status: 409, type: 'idempotency_error', code: 'DUPLICATE', retryable: false },
    { status: 400, type: 'idempotency_error', code: 'DUPLICATE', retryable: false },
    { status: 424, type: 'card_error', code: 'PROVIDER_UNAVAILABLE', retryable: true },
    { status: 402, type: 'card_error', code: 'DECLINED', retryable: false },
    { status: 402, type: null, code: 'UNKNOWN', retryable: true },
    { status: 400, type: null, code: 'INVALID_REQUEST', retryable: false },
  ] as const;
  for (const item of cases) {
    const error = classifyStripePaymentHttpError(item.status, { error: { type: item.type } }, 'Fallback');
    assert.equal(error instanceof PaymentProviderError, true);
    assert.equal(error.code, item.code, String(item.status));
    assert.equal(error.retryable, item.retryable, String(item.status));
  }
});

test('Stripe distinguishes an in-flight idempotency conflict from parameter mismatch', () => {
  for (const status of [400, 409]) {
    const inUse = classifyStripePaymentHttpError(status, {
      error: { type: 'idempotency_error', code: 'idempotency_key_in_use' },
    }, 'Fallback');
    assert.equal(inUse.code, 'UNKNOWN');
    assert.equal(inUse.retryable, true);
  }
  const conflict = classifyStripePaymentHttpError(409, { error: { type: 'invalid_request_error' } }, 'Fallback');
  assert.equal(conflict.code, 'UNKNOWN');
  assert.equal(conflict.retryable, true);
  const mismatch = classifyStripePaymentHttpError(400, {
    error: { type: 'idempotency_error', code: 'idempotency_key_reused' },
  }, 'Fallback');
  assert.equal(mismatch.code, 'DUPLICATE');
  assert.equal(mismatch.retryable, false);
});

test('Stripe HTTP lookup classification keeps 404 and timeout semantics separate', () => {
  for (const item of [
    { status: 401, code: 'AUTHENTICATION_FAILED', retryable: false },
    { status: 404, code: 'INVALID_REQUEST', retryable: false },
    { status: 408, code: 'TIMEOUT', retryable: true },
    { status: 409, code: 'UNKNOWN', retryable: true },
    { status: 402, code: 'UNKNOWN', retryable: true },
    { status: 424, code: 'PROVIDER_UNAVAILABLE', retryable: true },
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

test('Stripe write status outranks contradictory decline hints and preserves actionable failures', () => {
  const cases = [
    { status: 400, error: { type: 'card_error', code: 'card_declined' }, code: 'INVALID_REQUEST', retryable: false },
    { status: 404, error: { type: 'card_error', decline_code: 'generic_decline' }, code: 'INVALID_REQUEST', retryable: false },
    { status: 400, error: { type: 'api_error' }, code: 'UNKNOWN', retryable: true },
    { status: 422, error: { type: 'api_error' }, code: 'UNKNOWN', retryable: true },
    { status: 402, error: { type: 'api_error', code: 'card_declined' }, code: 'UNKNOWN', retryable: true },
    { status: 402, error: { type: 'invalid_request_error', decline_code: 'generic_decline' }, code: 'UNKNOWN', retryable: true },
    { status: 402, error: { code: 'card_declined' }, code: 'DECLINED', retryable: false },
    { status: 402, error: { decline_code: 'generic_decline' }, code: 'DECLINED', retryable: false },
    { status: 402, error: { type: 'card_error', code: 'card_declined' }, code: 'DECLINED', retryable: false },
    { status: 402, error: { type: 'card_error', code: 'authentication_required' }, code: 'UNKNOWN', retryable: true },
    { status: 402, error: { type: 'card_error', code: 'payment_intent_action_required' }, code: 'UNKNOWN', retryable: true },
    { status: 402, error: { type: 'card_error', code: 'processing_error' }, code: 'UNKNOWN', retryable: true },
    { status: 400, error: { type: 'idempotency_error' }, code: 'DUPLICATE', retryable: false },
    { status: 409, error: { type: 'idempotency_error' }, code: 'DUPLICATE', retryable: false },
    { status: 409, error: { type: 'card_error' }, code: 'UNKNOWN', retryable: true },
    { status: 424, error: { type: 'card_error' }, code: 'PROVIDER_UNAVAILABLE', retryable: true },
  ] as const;
  for (const item of cases) {
    const result = classifyStripePaymentHttpError(item.status, { error: item.error }, 'Fallback');
    assert.equal(result.code, item.code, `HTTP ${item.status}: ${JSON.stringify(item.error)}`);
    assert.equal(result.retryable, item.retryable, `HTTP ${item.status}: ${JSON.stringify(item.error)}`);
  }
});

test('Stripe read-only lookup preserves provider-side api_error without changing missing-resource authority', () => {
  for (const item of [
    { status: 400, type: 'api_error', code: 'UNKNOWN', retryable: true },
    { status: 422, type: 'api_error', code: 'UNKNOWN', retryable: true },
    { status: 404, type: 'api_error', code: 'INVALID_REQUEST', retryable: false },
    { status: 400, type: 'invalid_request_error', code: 'INVALID_REQUEST', retryable: false },
  ] as const) {
    const result = classifyStripeLookupHttpError(item.status, { error: { type: item.type } }, 'Fallback', 'Not found');
    assert.equal(result.code, item.code);
    assert.equal(result.retryable, item.retryable);
  }
});
