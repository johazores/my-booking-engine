import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  HOSPITALITY_SUPPLIER_PRE_PROVIDER_EXECUTION_FAILURE_CODE,
  classifyHospitalitySupplierPreProviderFailure,
} from './hospitality-supplier-pre-provider-failure.ts';

const cases = [
  ['AUTHENTICATION_FAILED', false],
  ['RATE_LIMITED', true],
  ['PROVIDER_UNAVAILABLE', true],
  ['TIMEOUT', true],
  ['INVALID_REQUEST', false],
  ['INVALID_RESPONSE', false],
] as const;

for (const [code, retryable] of cases) {
  test(`preserves provider retry authority for ${code}`, () => {
    const failure = classifyHospitalitySupplierPreProviderFailure(
      new HospitalitySupplierProviderError(code),
    );
    assert.deepEqual(failure, { failureCode: code, retryable });
  });
}

test('retry authority is derived from the canonical failure code instead of mutable error fields', () => {
  const error = new HospitalitySupplierProviderError('INVALID_REQUEST') as HospitalitySupplierProviderError & {
    retryable: boolean;
  };
  Object.defineProperty(error, 'retryable', { value: true, configurable: true });

  assert.deepEqual(classifyHospitalitySupplierPreProviderFailure(error), {
    failureCode: 'INVALID_REQUEST',
    retryable: false,
  });
});

test('mutated or hostile typed failures fail closed instead of interrupting settlement', () => {
  const mutated = new HospitalitySupplierProviderError('TIMEOUT') as HospitalitySupplierProviderError & {
    code: string;
  };
  Object.defineProperty(mutated, 'code', { value: 'SOURCE_PRIVATE_CODE', configurable: true });
  assert.deepEqual(classifyHospitalitySupplierPreProviderFailure(mutated), {
    failureCode: HOSPITALITY_SUPPLIER_PRE_PROVIDER_EXECUTION_FAILURE_CODE,
    retryable: false,
  });

  const revocable = Proxy.revocable(new HospitalitySupplierProviderError('TIMEOUT'), {});
  revocable.revoke();
  assert.deepEqual(classifyHospitalitySupplierPreProviderFailure(revocable.proxy), {
    failureCode: HOSPITALITY_SUPPLIER_PRE_PROVIDER_EXECUTION_FAILURE_CODE,
    retryable: false,
  });
});

test('unexpected pre-provider failures fail closed instead of inventing retry authority', () => {
  const failure = classifyHospitalitySupplierPreProviderFailure(new Error('programming failure'));
  assert.deepEqual(failure, {
    failureCode: HOSPITALITY_SUPPLIER_PRE_PROVIDER_EXECUTION_FAILURE_CODE,
    retryable: false,
  });
});
