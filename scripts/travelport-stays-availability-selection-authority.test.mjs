import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-reservation-authority-provider.ts', import.meta.url),
  'utf8',
);
const authority = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-availability-selection-authority.ts', import.meta.url),
  'utf8',
);
const docs = readFileSync(
  new URL('../docs/travelport-stays-availability-selection-authority.md', import.meta.url),
  'utf8',
);

test('Availability selection authority composes around the existing reservation response guard', () => {
  assert.match(wrapper, /const responseAuthorityFetch = createTravelportStaysReservationAuthorityResponseFetch\([\s\S]*authority\.fetchImpl \?\? fetch/);
  assert.match(wrapper, /fetchImpl: createTravelportStaysAvailabilitySelectionAuthorityFetch\(responseAuthorityFetch\)/);
  assert.match(wrapper, /extends CoreTravelportStaysReservationAuthorityProvider/);
});

test('Availability request and response authority is pinned to the generated single-selection shape', () => {
  assert.match(authority, /AVAILABILITY_PATH = '\/11\/hotel\/availability\/catalogofferingshospitality'/);
  assert.match(authority, /url\.protocol !== 'https:'/);
  assert.match(authority, /url\.port !== ''/);
  assert.match(authority, /url\.username !== ''/);
  assert.match(authority, /criterion\.numberOfRooms !== 1/);
  assert.match(authority, /aggregator !== 'TVPT' && aggregator !== 'BKNG'/);
  assert.match(authority, /propertyKey\.chainCode !== authority\.chainCode/);
  assert.match(authority, /identifier\.authority !== authority\.aggregator/);
  assert.match(authority, /product\.guests !== authority\.totalGuests/);
  assert.match(authority, /product\.Quantity as number\) < authority\.numberOfRooms/);
  assert.match(authority, /const paginationAuthorities = new Map<string, PaginationSelectionAuthority>\(\)/);
  assert.match(authority, /pagination token is not bound to an active selection authority/);
  assert.match(authority, /PAGINATION_AUTHORITY_TTL_MS = 30 \* 60 \* 1_000/);
});

test('Availability selection authority stays read-only and preserves activation gates', () => {
  assert.doesNotMatch(authority, /CardNumber|SeriesCode|FormOfPayment|acceptPriceChangeInd|acceptGuaranteeChangeInd/);
  assert.match(docs, /does not advertise Travelport `reservation`/);
  assert.match(docs, /Malformed request authority fails before network I\/O/);
  assert.match(docs, /locator-less recovery semantics/);
});
