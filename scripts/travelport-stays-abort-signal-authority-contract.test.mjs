import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

test('three credentialed Travelport request boundaries reject invalid native signal authority', () => {
  const guard = source('src/server/suppliers/travelport-stays-abort-signal-authority.ts');
  assert.match(guard, /Reflect\.get\(AbortSignal\.prototype, 'aborted', signal\) === false/);
  assert.match(guard, /HospitalitySupplierProviderError\('INVALID_REQUEST'/);
  for (const path of [
    'src/server/suppliers/travelport-stays-trace-fetch.ts',
    'src/server/suppliers/travelport-stays-oauth-credential-containment-fetch.ts',
    'src/server/suppliers/travelport-stays-reservation-trace-fetch.ts',
  ]) {
    const content = source(path);
    assert.match(content, /assertTravelportStaysAbortSignalReady\(signal\)/, path);
    assert.match(content, /travelport-stays-abort-signal-authority\.ts/, path);
  }
});

test('preflight composes both guarded transports without I/O, while logger remains observational', () => {
  const preflight = source('src/server/suppliers/travelport-stays-transport-preflight.ts');
  assert.match(preflight, /fetchImpl: credentialContainedFetch/);
  assert.match(preflight, /fetchImpl: noIoTravelportStaysPreflightFetch/);
  const logger = source('src/server/suppliers/travelport-stays-operational-log-fetch.ts');
  assert.match(logger, /function safeSignalAborted/);
  assert.doesNotMatch(logger, /assertTravelportStaysAbortSignalReady/);
  const docs = source('docs/travelport-stays-abort-signal-authority.md');
  assert.match(docs, /durable provider-request marker/);
  assert.match(docs, /does not advertise the `reservation` capability/);
});
