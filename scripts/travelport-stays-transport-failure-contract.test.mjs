import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (path) => readFileSync(join(root, path), 'utf8');

test('Travelport read and authentication paths preserve typed transport-boundary failures', () => {
  for (const path of [
    'src/server/suppliers/travelport-stays-provider.ts',
    'src/server/suppliers/travelport-stays-booking-terms-provider.ts',
    'src/server/suppliers/travelport-stays-reservation-authority-provider.ts',
    'src/server/suppliers/travelport-stays-reservation-recovery-provider.ts',
  ]) {
    const content = source(path);
    assert.match(content, /hospitality-supplier-transport-failure\.ts/);
    assert.match(content, /catch \(error\) \{[\s\S]{0,180}throwHospitalitySupplierTransportFailure\(error, controller\.signal\)/);
    assert.doesNotMatch(
      content,
      /catch \{[\s\S]{0,160}HospitalitySupplierProviderError\(controller\.signal\.aborted \? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE'\)/,
    );
  }
});

test('shared supplier transport failure helper keeps timeout precedence and typed failure authority', () => {
  const helper = source('src/server/suppliers/hospitality-supplier-transport-failure.ts');
  assert.match(helper, /if \(signal\.aborted\)/);
  assert.match(helper, /HospitalitySupplierProviderError\('TIMEOUT'\)/);
  assert.match(helper, /error instanceof HospitalitySupplierProviderError/);
  assert.match(helper, /throw error/);
  assert.match(helper, /HospitalitySupplierProviderError\('PROVIDER_UNAVAILABLE'\)/);
});

test('Travelport tracing documentation records transport failure authority', () => {
  const doc = source('docs/travelport-stays-request-tracing.md');
  assert.match(doc, /preserve normalized `HospitalitySupplierProviderError` values/);
  assert.match(doc, /non-retryable `INVALID_REQUEST` or `INVALID_RESPONSE` authority/);
  assert.match(doc, /caller-owned deadline remains authoritative as `TIMEOUT`/);
  assert.match(doc, /unknown low-level transport failures normalize to bounded `PROVIDER_UNAVAILABLE`/);
});
