import assert from 'node:assert/strict';
import test from 'node:test';

import { paymentProviderClientError } from './payment-provider-client-error.ts';
import type { PaymentProviderFailureCode } from './payment-provider.ts';

const ALL_FAILURE_CODES: readonly PaymentProviderFailureCode[] = [
  'INVALID_REQUEST',
  'AUTHENTICATION_FAILED',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT',
  'DECLINED',
  'DUPLICATE',
  'UNSUPPORTED_OPERATION',
  'UNKNOWN',
];

test('provider client failures expose only normalized provider-neutral fields', () => {
  for (const code of ALL_FAILURE_CODES) {
    const result = paymentProviderClientError({ code, retryable: code === 'TIMEOUT' });
    assert.deepEqual(Object.keys(result).sort(), ['code', 'message', 'retryable']);
    assert.equal(result.code, code);
    assert.equal(result.retryable, code === 'TIMEOUT');
    assert.ok(result.message.startsWith('Payment provider'));
    assert.equal(/stripe|paypal|secret|token|paymentintent|refund_/i.test(result.message), false);
  }
});

test('provider client failure messages distinguish retryable operational classes without raw provider text', () => {
  assert.equal(
    paymentProviderClientError({ code: 'TIMEOUT', retryable: true }).message,
    'Payment provider did not respond in time. Try again.',
  );
  assert.equal(
    paymentProviderClientError({ code: 'DECLINED', retryable: false }).message,
    'Payment provider declined the operation.',
  );
  assert.equal(
    paymentProviderClientError({ code: 'AUTHENTICATION_FAILED', retryable: false }).message,
    'Payment provider configuration is unavailable.',
  );
});
