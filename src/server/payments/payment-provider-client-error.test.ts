import assert from 'node:assert/strict';
import test from 'node:test';

import {
  paymentProviderClientError,
  paymentProviderClientErrorFromThrown,
  publicPaymentProviderClientError,
} from './payment-provider-client-error.ts';
import { PaymentProviderError, type PaymentProviderFailureCode } from './payment-provider.ts';

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

test('thrown-value presentation accepts only constructor-branded provider failures', () => {
  const failure = new PaymentProviderError('TIMEOUT', 'raw provider diagnostic', true);
  assert.deepEqual(paymentProviderClientErrorFromThrown(failure), {
    code: 'TIMEOUT',
    retryable: true,
    message: 'Payment provider did not respond in time. Try again.',
  });

  const prototypeLookalike = Object.create(PaymentProviderError.prototype) as Record<string, unknown>;
  Object.defineProperties(prototypeLookalike, {
    code: { value: 'TIMEOUT', enumerable: true },
    retryable: { value: true, enumerable: true },
  });
  assert.equal(paymentProviderClientErrorFromThrown(prototypeLookalike), null);
  assert.equal(paymentProviderClientErrorFromThrown({ code: 'TIMEOUT', retryable: true }), null);
});

test('public provider presentation distinguishes only definitive decline from safe operational unavailability', () => {
  assert.deepEqual(
    publicPaymentProviderClientError(new PaymentProviderError('PROVIDER_UNAVAILABLE', 'raw upstream text', true)),
    { error: 'payment-temporarily-unavailable', status: 503 },
  );
  assert.deepEqual(
    publicPaymentProviderClientError(new PaymentProviderError('DECLINED', 'raw decline text', false)),
    { error: 'payment-rejected', status: 409 },
  );

  for (const code of [
    'INVALID_REQUEST',
    'AUTHENTICATION_FAILED',
    'DUPLICATE',
    'UNSUPPORTED_OPERATION',
    'UNKNOWN',
  ] as const) {
    const result = publicPaymentProviderClientError(new PaymentProviderError(code, 'raw upstream text', false));
    assert.deepEqual(result, { error: 'payment-unavailable', status: 502 });
    assert.equal(result && 'code' in result, false);
    assert.equal(result && 'message' in result, false);
  }

  assert.equal(publicPaymentProviderClientError({ code: 'DECLINED', retryable: false }), null);
});
