import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

const provider = source('src/server/suppliers/travelport-stays-provider.ts');
const availability = source('src/server/suppliers/travelport-stays-availability-selection-authority.ts');
const transportDocs = source('docs/travelport-stays-transport-token-authority.md');
const availabilityDocs = source('docs/travelport-stays-availability-selection-authority.md');

test('SearchComplete continuation response tokens cannot contradict the replayed request token', () => {
  assert.match(provider, /paginationToken: string \| null/);
  assert.match(provider, /const paginationToken = exactMachineToken\([\s\S]*decodeURIComponent\(identifier\)/);
  assert.match(provider, /pagination\.paginationToken !== undefined[\s\S]*requestAuthority\.paginationToken/);
  assert.match(provider, /SearchComplete pagination token changed across the active result set/);
  assert.match(transportDocs, /present continuation response token must equal the exact token replayed in the request/);
});

test('Availability continuation response identifiers cannot contradict active token authority', () => {
  assert.match(availability, /function availabilityResponsePaginationIdentifier\(payload: unknown\): string \| null/);
  assert.match(availability, /observedIdentifier !== null && observedIdentifier !== continuation\.token/);
  assert.match(availability, /Availability pagination identifier changed across the active result set/);
  assert.match(availabilityDocs, /present continuation `CatalogOfferings\.Identifier\.value` must equal the active page-one token/);
});

test('optional continuation token evidence stays optional while contradictory evidence fails closed', () => {
  assert.match(provider, /pagination\.paginationToken !== undefined/);
  assert.match(availability, /return identifier \? responseMachineString\(identifier\.value, 4_096\) : null/);
  assert.match(transportDocs, /does not make the token mandatory on continuation responses/);
  assert.match(availabilityDocs, /does not invent a requirement that Travelport repeat the identifier on every continuation response/);
});
