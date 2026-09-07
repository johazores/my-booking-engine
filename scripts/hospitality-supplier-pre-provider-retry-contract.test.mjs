import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const helper = readFileSync(new URL('src/server/suppliers/hospitality-supplier-pre-provider-failure.ts', root), 'utf8');
const createService = readFileSync(new URL('src/server/suppliers/travelport-stays-reservation-create-service.ts', root), 'utf8');
const syncService = readFileSync(new URL('src/server/suppliers/travelport-stays-reservation-sync-service.ts', root), 'utf8');

for (const [name, source] of [
  ['Travelport Create', createService],
  ['Travelport Sync', syncService],
]) {
  test(`${name} settles pre-provider failures through provider-neutral retry authority`, () => {
    assert.match(source, /classifyHospitalitySupplierPreProviderFailure\(input\.error\)/);
    assert.match(source, /failureCode: failure\.failureCode/);
    assert.match(source, /retryable: failure\.retryable/);
    assert.doesNotMatch(source, /failureCode: preProviderFailureCode\(input\.error\)[\s\S]{0,120}retryable: true/);
  });
}

test('pre-provider retry authority fails closed for untyped failures', () => {
  assert.match(helper, /error instanceof HospitalitySupplierProviderError/);
  assert.match(helper, /retryable: error\.retryable/);
  assert.match(helper, /PRE_PROVIDER_EXECUTION_FAILED/);
  assert.match(helper, /retryable: false/);
});
