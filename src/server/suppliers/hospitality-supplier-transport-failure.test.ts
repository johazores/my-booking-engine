import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { throwHospitalitySupplierTransportFailure } from './hospitality-supplier-transport-failure.ts';

test('preserves normalized supplier transport failures when the caller deadline has not fired', () => {
  const controller = new AbortController();
  const original = new HospitalitySupplierProviderError('INVALID_REQUEST', 'blocked by the supplier transport boundary');

  assert.throws(
    () => throwHospitalitySupplierTransportFailure(original, controller.signal),
    (error) => error === original,
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
