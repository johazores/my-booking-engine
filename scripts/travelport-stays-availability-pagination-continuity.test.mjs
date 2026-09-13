import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const authority = source('src/server/suppliers/travelport-stays-availability-selection-authority.ts');
const docs = source('docs/travelport-stays-availability-selection-authority.md');

test('Availability selection token state binds page-one result-set geometry', () => {
  assert.match(authority, /type PaginationSelectionAuthority = Readonly<\{[\s\S]*totalCatalogOffering: number \| null;[\s\S]*numberOfPages: number;/);
  assert.match(authority, /continuation\.pageNumber > stored\.numberOfPages/);
  assert.match(authority, /pagination page exceeds the active result set/);
  assert.match(authority, /observed\.numberOfPages !== stored\.numberOfPages/);
  assert.match(authority, /stored\.totalCatalogOffering !== null[\s\S]*observed\.totalCatalogOffering !== stored\.totalCatalogOffering/);
});

test('continuity is proven before final-page token state is consumed', () => {
  const selectionIndex = authority.indexOf('assertAvailabilityResponseSelection(payload, stored.authority)');
  const metadataIndex = authority.indexOf('const observed = availabilityResponsePaginationMetadata(payload)', selectionIndex);
  const comparisonIndex = authority.indexOf('observed.numberOfPages !== stored.numberOfPages', metadataIndex);
  const deletionIndex = authority.indexOf('paginationAuthorities.delete(continuation.token)', comparisonIndex);
  assert.ok(selectionIndex >= 0 && metadataIndex > selectionIndex && comparisonIndex > metadataIndex && deletionIndex > comparisonIndex);
});

test('active result-set state stays bounded and cannot be silently rebound', () => {
  assert.match(authority, /paginationAuthorities\.has\(pagination\.token\)/);
  assert.match(authority, /pagination token was reused for an active result set/);
  assert.match(authority, /MAX_ACTIVE_PAGINATION_AUTHORITIES = 64/);
  assert.match(authority, /PAGINATION_AUTHORITY_TTL_MS = 30 \* 60 \* 1_000/);
  assert.match(docs, /non-consecutive page retrieval remains supported/);
  assert.match(docs, /fails before provider I\/O/);
  assert.match(docs, /does not advertise Travelport `reservation`/);
  assert.match(docs, /locator-less recovery semantics/);
});
