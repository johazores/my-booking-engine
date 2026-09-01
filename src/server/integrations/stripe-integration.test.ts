import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeStripeIntegrationConfiguration, StripeIntegrationConfigurationError } from './stripe-integration.ts';

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
