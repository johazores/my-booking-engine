import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function source(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('provider failure authority is snapshotted and retryability is code-derived', () => {
  const provider = source('src/server/suppliers/hospitality-supplier-provider.ts');
  const preProvider = source('src/server/suppliers/hospitality-supplier-pre-provider-failure.ts');
  const transport = source('src/server/suppliers/hospitality-supplier-transport-failure.ts');
  const reconciliation = source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts');
  const paymentSource = source('src/server/suppliers/travelport-stays-reservation-payment-card-source.ts');

  assert.match(provider, /function hospitalitySupplierFailureIsRetryable/);
  assert.match(provider, /export function inspectHospitalitySupplierProviderFailure/);
  assert.match(provider, /try \{[\s\S]*?instanceof HospitalitySupplierProviderError[\s\S]*?hospitalitySupplierFailureCodes\.includes\(code\)[\s\S]*?hospitalitySupplierFailureIsRetryable\(code\)[\s\S]*?\} catch \{[\s\S]*?return null/);

  assert.match(preProvider, /inspectHospitalitySupplierProviderFailure\(error\)/);
  assert.match(preProvider, /failureCode: providerFailure\.code/);
  assert.match(preProvider, /retryable: providerFailure\.retryable/);
  assert.doesNotMatch(preProvider, /error instanceof HospitalitySupplierProviderError/);

  assert.match(transport, /inspectHospitalitySupplierProviderFailure\(error\)/);
  assert.match(transport, /throw new HospitalitySupplierProviderError\(providerFailure\.code\)/);
  assert.doesNotMatch(transport, /throw error/);

  assert.match(reconciliation, /const providerFailure = inspectHospitalitySupplierProviderFailure\(error\)/);
  assert.match(reconciliation, /failureCode: providerFailure\?\.code \?\? 'INVALID_REQUEST'/);
  assert.match(reconciliation, /const failureCode = providerFailure\?\.code \?\? 'PROVIDER_UNAVAILABLE'/);
  assert.doesNotMatch(reconciliation, /error instanceof HospitalitySupplierProviderError/);

  assert.match(paymentSource, /inspectHospitalitySupplierProviderFailure\(error\)/);
  assert.match(paymentSource, /providerFailure\?\.code \?\? 'INVALID_REQUEST'/);
  assert.doesNotMatch(paymentSource, /hospitalitySupplierFailureCodes/);
});

test('provider failure authority is documented as fail closed and non-activating', () => {
  const documentation = source('docs/supplier-provider-failure-authority.md');
  assert.match(documentation, /retryability is derived from the canonical failure code/i);
  assert.match(documentation, /hostile|revoked proxy/i);
  assert.match(documentation, /raw provider or source error messages are not propagated/i);
  assert.match(documentation, /does not enable the Travelport `reservation` capability/i);
});
