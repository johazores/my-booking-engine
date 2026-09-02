import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeStripeIntegrationConfiguration,
  probeStripeIntegrationHealth,
  StripeIntegrationConfigurationError,
} from './stripe-integration.ts';

test('Stripe integration configuration advertises webhooks only with a signing secret', () => {
  const withoutWebhook = normalizeStripeIntegrationConfiguration({ secretKey: ' sk_test_123456789 ' });
  assert.deepEqual(withoutWebhook.credentials, { secretKey: 'sk_test_123456789' });
  assert.deepEqual(withoutWebhook.capabilities, ['payment-authorize', 'payment-capture', 'payment-refund']);

  const withWebhook = normalizeStripeIntegrationConfiguration({
    secretKey: 'sk_test_123456789',
    webhookSecret: ' whsec_test_123456789 ',
  });
  assert.deepEqual(withWebhook.credentials, {
    secretKey: 'sk_test_123456789',
    webhookSecret: 'whsec_test_123456789',
  });
  assert.deepEqual(withWebhook.capabilities, ['payment-authorize', 'payment-capture', 'payment-refund', 'webhooks']);
});

test('Stripe integration configuration rejects invalid provider credentials', () => {
  assert.throws(
    () => normalizeStripeIntegrationConfiguration({ secretKey: 'pk_test_public' }),
    StripeIntegrationConfigurationError,
  );
  assert.throws(
    () => normalizeStripeIntegrationConfiguration({ secretKey: 'sk_test_123456789', webhookSecret: 'not-a-webhook-secret' }),
    StripeIntegrationConfigurationError,
  );
});

test('Stripe health probe uses a read-only authenticated balance request and exposes no account data', async () => {
  let observedUrl = '';
  let observedAuthorization = '';
  let observedMethod = '';

  const result = await probeStripeIntegrationHealth({
    secretKey: 'sk_test_123456789',
    fetchImpl: async (input, init) => {
      observedUrl = String(input);
      observedAuthorization = String(new Headers(init?.headers).get('authorization'));
      observedMethod = String(init?.method);
      return new Response(JSON.stringify({
        object: 'balance',
        available: [{ amount: 99999999, currency: 'usd' }],
        livemode: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.equal(observedUrl, 'https://api.stripe.com/v1/balance');
  assert.equal(observedAuthorization, 'Bearer sk_test_123456789');
  assert.equal(observedMethod, 'GET');
  assert.deepEqual(result, { status: 'HEALTHY', failureCode: null });
  assert.equal('available' in result, false);
  assert.equal('livemode' in result, false);
});

test('Stripe health probe classifies provider failures without returning raw provider payloads', async () => {
  const authentication = await probeStripeIntegrationHealth({
    secretKey: 'sk_test_123456789',
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'secret provider detail' } }), { status: 401 }),
  });
  const rateLimited = await probeStripeIntegrationHealth({
    secretKey: 'sk_test_123456789',
    fetchImpl: async () => new Response('{}', { status: 429 }),
  });
  const unavailable = await probeStripeIntegrationHealth({
    secretKey: 'sk_test_123456789',
    fetchImpl: async () => new Response('{}', { status: 503 }),
  });
  const invalid = await probeStripeIntegrationHealth({
    secretKey: 'sk_test_123456789',
    fetchImpl: async () => new Response(JSON.stringify({ object: 'unexpected' }), { status: 200 }),
  });

  assert.deepEqual(authentication, { status: 'AUTHENTICATION_FAILED', failureCode: 'AUTHENTICATION_FAILED' });
  assert.deepEqual(rateLimited, { status: 'RATE_LIMITED', failureCode: 'RATE_LIMITED' });
  assert.deepEqual(unavailable, { status: 'PROVIDER_UNAVAILABLE', failureCode: 'PROVIDER_UNAVAILABLE' });
  assert.deepEqual(invalid, { status: 'INVALID_RESPONSE', failureCode: 'INVALID_RESPONSE' });
});

test('Stripe health probe distinguishes network failure from timeout without exposing transport details', async () => {
  const networkFailure = await probeStripeIntegrationHealth({
    secretKey: 'sk_test_123456789',
    fetchImpl: async () => {
      throw new Error('socket details that must not escape');
    },
  });

  const timeout = await probeStripeIntegrationHealth({
    secretKey: 'sk_test_123456789',
    timeoutMs: 1_000,
    fetchImpl: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return reject(new Error('expected abort signal'));
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }),
  });

  assert.deepEqual(networkFailure, { status: 'PROVIDER_UNAVAILABLE', failureCode: 'PROVIDER_UNAVAILABLE' });
  assert.deepEqual(timeout, { status: 'PROVIDER_UNAVAILABLE', failureCode: 'TIMEOUT' });
});
