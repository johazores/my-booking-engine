import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HospitalitySupplierProviderError,
  inspectHospitalitySupplierProviderFailure,
} from './hospitality-supplier-provider.ts';

test('supplier failure authority accepts constructor-registered errors and derives retryability from code', () => {
  const timeout = new HospitalitySupplierProviderError('TIMEOUT');
  const invalid = new HospitalitySupplierProviderError('INVALID_REQUEST') as HospitalitySupplierProviderError & {
    retryable: boolean;
  };
  Object.defineProperty(invalid, 'retryable', { value: true, configurable: true });

  assert.deepEqual(inspectHospitalitySupplierProviderFailure(timeout), {
    code: 'TIMEOUT',
    retryable: true,
  });
  assert.deepEqual(inspectHospitalitySupplierProviderFailure(invalid), {
    code: 'INVALID_REQUEST',
    retryable: false,
  });
});

test('prototype-spoofed provider errors cannot invent supplier failure authority', () => {
  const forged = Object.create(HospitalitySupplierProviderError.prototype) as HospitalitySupplierProviderError;
  Object.defineProperties(forged, {
    code: { value: 'TIMEOUT', configurable: true },
    retryable: { value: true, configurable: true },
  });

  assert.equal(forged instanceof HospitalitySupplierProviderError, true);
  assert.equal(inspectHospitalitySupplierProviderFailure(forged), null);
});

test('mutated, invalid-code, and hostile supplier errors fail closed', () => {
  const mutated = new HospitalitySupplierProviderError('TIMEOUT') as HospitalitySupplierProviderError & {
    code: string;
  };
  Object.defineProperty(mutated, 'code', { value: 'INVALID_REQUEST', configurable: true });
  assert.equal(inspectHospitalitySupplierProviderFailure(mutated), null);

  const invalidCode = new HospitalitySupplierProviderError('SOURCE_PRIVATE_CODE' as never);
  assert.equal(inspectHospitalitySupplierProviderFailure(invalidCode), null);

  const revocable = Proxy.revocable(new HospitalitySupplierProviderError('TIMEOUT'), {});
  revocable.revoke();
  assert.equal(inspectHospitalitySupplierProviderFailure(revocable.proxy), null);
});
