import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('reservation authority guard binds Availability request route and page before provider I/O', async () => {
  const boundary = await source('src/server/suppliers/travelport-stays-reservation-authority-boundary.ts');
  const authorityIndex = boundary.indexOf('const requestAuthority = reservationAuthorityRequest');
  const fetchIndex = boundary.indexOf('const response = await fetchImpl', authorityIndex);

  assert.ok(authorityIndex >= 0 && fetchIndex > authorityIndex);
  assert.match(boundary, /AVAILABILITY_PATH = '\/11\/hotel\/availability\/catalogofferingshospitality'/);
  assert.match(boundary, /method !== 'POST' \|\| url\.search !== ''/);
  assert.match(boundary, /method !== 'GET'/);
  assert.match(boundary, /queryEntries\.length !== 1/);
  assert.match(boundary, /queryEntries\[0\]\?\.\[0\] !== 'pageNumber'/);
  assert.match(boundary, /!\/\^\[2-5\]\$\/\.test/);
  assert.match(boundary, /hasSingleCanonicalEncodedPathSegment/);
  assert.match(boundary, /hasCanonicalQueryEncoding/);
});

test('Availability pagination response authority matches Travelport five-page and 100-rate geometry', async () => {
  const boundary = await source('src/server/suppliers/travelport-stays-reservation-authority-boundary.ts');

  assert.match(boundary, /MAX_AVAILABILITY_PAGES = 5/);
  assert.match(boundary, /MAX_AVAILABILITY_OFFERS = 100/);
  assert.match(boundary, /MAX_AVAILABILITY_TOTAL_OFFERS = MAX_AVAILABILITY_PAGES \* MAX_AVAILABILITY_OFFERS/);
  assert.match(boundary, /const expectedPages = Math\.max\(1, Math\.ceil\(totalOffers \/ MAX_AVAILABILITY_OFFERS\)\)/);
  assert.match(boundary, /totalPages !== expectedPages/);
  assert.match(boundary, /requestAuthority\.pageNumber > totalPages/);
  assert.match(boundary, /const expectedPageSize = Math\.min\(MAX_AVAILABILITY_OFFERS, remainingOffers\)/);
  assert.match(boundary, /returnedOffers !== expectedPageSize \|\| offerings\.length !== expectedPageSize/);
  assert.match(boundary, /totalPages > 1/);
  assert.match(boundary, /Travelport Availability pagination identifier is missing/);
  assert.match(boundary, /Travelport Availability pagination identifier is unexpected/);
});

test('SearchComplete pagination uses exact 100-property geometry and canonical continuation authority', async () => {
  const provider = await source('src/server/suppliers/travelport-stays-provider.ts');

  assert.match(provider, /itemCount === 0 && \(currentPage !== 1 \|\| currentPageSize !== 0 \|\| pageCount !== 0\)/);
  assert.match(provider, /const expectedPages = Math\.ceil\(itemCount \/ MAX_SEARCH_PAGE_SIZE\)/);
  assert.match(provider, /const expectedPageSize = Math\.min\(MAX_SEARCH_PAGE_SIZE, Math\.max\(0, remainingItems\)\)/);
  assert.match(provider, /pageCount !== expectedPages \|\| currentPageSize !== expectedPageSize/);
  assert.match(provider, /hotelsResponse\.propertyItems\.length !== currentPageSize/);
  assert.match(provider, /hasCanonicalEncodedPathSegment\(identifier\)/);
  assert.match(provider, /hasCanonicalQueryEncoding\(parsed\)/);
});

test('SearchComplete successful responses fail closed on missing JSON or required envelopes', async () => {
  const provider = await source('src/server/suppliers/travelport-stays-provider.ts');

  assert.match(provider, /Travelport SearchComplete response is not valid JSON/);
  assert.match(provider, /Travelport SearchComplete response envelope is invalid/);
  assert.match(provider, /Travelport SearchComplete pagination metadata is missing/);
  assert.match(provider, /Travelport SearchComplete property collection is invalid/);
});

test('pagination documentation records the independent SearchComplete and Availability authority boundaries', async () => {
  const docs = await source('docs/travelport-stays-pagination-metadata-authority.md');

  assert.match(docs, /SearchComplete pagination authority/);
  assert.match(docs, /Availability pagination authority/);
  assert.match(docs, /canonical empty result/i);
  assert.match(docs, /valid JSON/i);
  assert.match(docs, /catalogOfferingPerPage/);
  assert.match(docs, /more than 100 rates/i);
  assert.match(docs, /before provider I\/O/);
  assert.match(docs, /reservation capability remains disabled/i);
});
