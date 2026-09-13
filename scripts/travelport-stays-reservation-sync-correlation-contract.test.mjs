import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (path) => readFileSync(join(root, path), 'utf8');
const canonicalPatternSource = "const SF_TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;";
const canonicalPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('Travelport reservation Sync accepts the same canonical SF UUID grammar as every trace authority layer', () => {
  for (const path of [
    'src/server/suppliers/travelport-stays-reservation-create-executor.ts',
    'src/server/suppliers/travelport-stays-reservation-sync-executor.ts',
    'src/server/suppliers/travelport-stays-response-trace.ts',
    'src/server/suppliers/travelport-stays-reservation-trace-fetch.ts',
    'src/server/suppliers/travelport-stays-trace-fetch.ts',
  ]) {
    assert.ok(source(path).includes(canonicalPatternSource), `${path} must keep the canonical SF UUID grammar`);
  }

  assert.equal(canonicalPattern.test('13b6a693-31e8-4a0d-895c-d0f620dbd1fa'), true);
  assert.equal(canonicalPattern.test('13b6a693-31e8-4a0d-8d0f620dbd1fa'), false);
  assert.equal(canonicalPattern.test('13b6a693-31e8-4a0d-895cd0f620dbd1fa'), false);
});

test('Travelport reservation Sync cannot regress to the truncated UUID tail grammar', () => {
  const sync = source('src/server/suppliers/travelport-stays-reservation-sync-executor.ts');
  assert.doesNotMatch(sync, /\[89ab\]\[0-9a-f\]\{12\}/);
  assert.match(sync, /SF_TRACE_ID_PATTERN\.test\(requestCorrelationId\)/);
  assert.match(sync, /E2ETrackingID: `sf-\$\{requestCorrelationId\}`/);
});
