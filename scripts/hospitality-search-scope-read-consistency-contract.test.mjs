import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/server/bookings/hospitality-search-service.ts', import.meta.url), 'utf8');

test('hospitality search scope metadata and bounded rows share one repeatable-read snapshot', () => {
  const start = source.indexOf('async function loadSearchScopes');
  const end = source.indexOf('\nasync function evaluateScope', start);
  assert.ok(start >= 0 && end > start, 'loadSearchScopes must remain present');
  const scopeReader = source.slice(start, end);

  assert.match(scopeReader, /organizationId: input\.organizationId/);
  assert.match(scopeReader, /input\.propertyId \? \{ propertyId: input\.propertyId \} : \{\}/);
  assert.match(scopeReader, /roomType: \{ is: \{ status: 'ACTIVE' as const, property: \{ is: \{ status: 'ACTIVE' as const \} \} \} \}/);
  assert.match(scopeReader, /ratePlan: \{ is: \{ status: 'ACTIVE' as const, property: \{ is: \{ status: 'ACTIVE' as const \} \} \} \}/);
  assert.match(scopeReader, /db\.\$transaction\(async \(transaction\) => \{/);
  assert.match(scopeReader, /transaction\.hospitalityRoomTypeRatePlan\.count\(\{ where \}\)/);
  assert.match(scopeReader, /transaction\.hospitalityRoomTypeRatePlan\.findMany\(\{/);
  assert.match(scopeReader, /orderBy: \[\{ propertyId: 'asc' \}, \{ roomTypeId: 'asc' \}, \{ ratePlanId: 'asc' \}\]/);
  assert.match(scopeReader, /take: MAX_SEARCH_SCOPES/);
  assert.match(scopeReader, /isolationLevel: 'RepeatableRead'/);
  assert.doesNotMatch(scopeReader, /Promise\.all/);
});

test('hospitality search exposes coherent scope-limit metadata from the snapshot result', () => {
  assert.match(source, /const \{ totalScopes, scopes \} = await loadSearchScopes/);
  assert.match(source, /searchedScopes: scopes\.length/);
  assert.match(source, /totalScopes,/);
  assert.match(source, /scopeLimit: MAX_SEARCH_SCOPES/);
  assert.match(source, /scopeLimitReached: totalScopes > scopes\.length/);
});
