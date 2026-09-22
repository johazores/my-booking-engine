import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectPaymentProviderFailure,
  PaymentProviderError,
  paymentProviderFailureCodes,
} from './payment-provider.ts';

test('payment provider errors expose immutable constructor-owned machine authority', () => {
  const failure = new PaymentProviderError('TIMEOUT', 'provider diagnostic', true);
  assert.equal(failure instanceof PaymentProviderError, true);
  assert.deepEqual(inspectPaymentProviderFailure(failure), { code: 'TIMEOUT', retryable: true });
  assert.equal(Object.isFrozen(inspectPaymentProviderFailure(failure)), true);

  assert.throws(() => {
    (failure as { retryable: boolean }).retryable = false;
  }, TypeError);
  assert.throws(() => {
    Object.defineProperty(failure, 'code', { value: 'DECLINED' });
  }, TypeError);

  assert.equal(failure.code, 'TIMEOUT');
  assert.equal(failure.retryable, true);
});

test('payment provider instanceof rejects prototype lookalikes and revoked proxies', () => {
  const lookalike = Object.create(PaymentProviderError.prototype) as {
    code: string;
    retryable: boolean;
  };
  lookalike.code = 'TIMEOUT';
  lookalike.retryable = true;
  assert.equal(lookalike instanceof PaymentProviderError, false);
  assert.equal(inspectPaymentProviderFailure(lookalike), null);

  const genuine = new PaymentProviderError('PROVIDER_UNAVAILABLE', 'provider diagnostic', true);
  const { proxy, revoke } = Proxy.revocable(genuine, {});
  revoke();
  assert.equal(proxy instanceof PaymentProviderError, false);
  assert.equal(inspectPaymentProviderFailure(proxy), null);
});

test('payment provider constructor rejects failure authority outside the runtime contract', () => {
  assert.deepEqual(paymentProviderFailureCodes, [
    'INVALID_REQUEST',
    'AUTHENTICATION_FAILED',
    'RATE_LIMITED',
    'PROVIDER_UNAVAILABLE',
    'TIMEOUT',
    'DECLINED',
    'DUPLICATE',
    'UNSUPPORTED_OPERATION',
    'UNKNOWN',
  ]);

  assert.throws(
    () => new PaymentProviderError('NOT_A_FAILURE' as never, 'provider diagnostic', true),
    TypeError,
  );
  assert.throws(
    () => new PaymentProviderError('TIMEOUT', 'provider diagnostic', 'yes' as never),
    TypeError,
  );
});
