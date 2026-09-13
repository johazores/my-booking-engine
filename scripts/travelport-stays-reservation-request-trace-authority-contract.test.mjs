import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('reservation request trace authority materializes the exact v11 pair before delegated I/O', () => {
  const wrapper = source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');

  assert.match(wrapper, /const headers = requestHeaders\(input, init\);/);
  assert.match(wrapper, /const e2eTrackingId = headers\.get\('E2ETrackingID'\);/);
  assert.match(wrapper, /const expectedTraceId = e2eTrackingId\.slice\(SF_E2E_PREFIX\.length\);/);
  assert.match(wrapper, /SF_TRACE_ID_PATTERN\.test\(expectedTraceId\)/);
  assert.match(wrapper, /headers\.set\('TraceId', expectedTraceId\);/);
  assert.match(wrapper, /headers\.delete\('TVP-Trace-Id'\);/);
  assert.match(
    wrapper,
    /const response = await fetchImpl\(\s*input,\s*reservation \? \{ \.\.\.init, headers: reservation\.headers \} : init,\s*\);/,
    'canonical request trace headers must be materialized before the delegated fetch executes',
  );
});


test('reservation request trace documentation records v11 authority and the activation boundary', () => {
  const doc = source('docs/travelport-reservation-request-trace-authority.md');
  assert.match(doc, /`TraceId: <attempt UUID>`/);
  assert.match(doc, /`E2ETrackingID: sf-<attempt UUID>`/);
  assert.match(doc, /`TVP-Trace-Id` is deleted/);
  assert.match(doc, /before delegated provider I\/O/);
  assert.match(doc, /does not advertise or enable Travelport `reservation`/);
});
