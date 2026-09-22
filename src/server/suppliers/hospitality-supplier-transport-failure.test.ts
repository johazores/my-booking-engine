import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { throwHospitalitySupplierTransportFailure } from './hospitality-supplier-transport-failure.ts';

test('rematerializes normalized supplier transport failures without preserving source messages', () => {
  const controller = new AbortController();
  const original = new HospitalitySupplierProviderError('INVALID_REQUEST', 'blocked by a private supplier diagnostic');

  assert.throws(
    () => throwHospitalitySupplierTransportFailure(original, controller.signal),
    (error) => error instanceof HospitalitySupplierProviderError
      && error !== original
      && error.code === 'INVALID_REQUEST'
      && error.retryable === false
      && !error.message.includes('private supplier diagnostic'),
  );
});

test('keeps the caller timeout authoritative over a concurrent transport failure', () => {
  const controller = new AbortController();
  controller.abort();

  assert.throws(
    () => throwHospitalitySupplierTransportFailure(
      new HospitalitySupplierProviderError('INVALID_RESPONSE'),
      controller.signal,
    ),
    (error) => error instanceof HospitalitySupplierProviderError
      && error.code === 'TIMEOUT'
      && error.retryable === true,
  );
});

test('normalizes unknown transport failures without leaking their implementation details', () => {
  const controller = new AbortController();

  assert.throws(
    () => throwHospitalitySupplierTransportFailure(new Error('socket implementation detail'), controller.signal),
    (error) => error instanceof HospitalitySupplierProviderError
      && error.code === 'PROVIDER_UNAVAILABLE'
      && error.retryable === true
      && !error.message.includes('socket implementation detail'),
  );
});

test('hostile or mutated supplier errors fail closed at the transport boundary', () => {
  const controller = new AbortController();
  const mutated = new HospitalitySupplierProviderError('TIMEOUT') as HospitalitySupplierProviderError & {
    code: string;
  };
  Object.defineProperty(mutated, 'code', { value: 'SOURCE_PRIVATE_CODE', configurable: true });
  assert.throws(
    () => throwHospitalitySupplierTransportFailure(mutated, controller.signal),
    (error) => error instanceof HospitalitySupplierProviderError
      && error.code === 'PROVIDER_UNAVAILABLE'
      && error.retryable === true,
  );

  const revocable = Proxy.revocable(new HospitalitySupplierProviderError('TIMEOUT'), {});
  revocable.revoke();
  assert.throws(
    () => throwHospitalitySupplierTransportFailure(revocable.proxy, controller.signal),
    (error) => error instanceof HospitalitySupplierProviderError
      && error.code === 'PROVIDER_UNAVAILABLE'
      && error.retryable === true,
  );
});
