import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-booking-terms-provider.ts', import.meta.url),
  'utf8',
);
const authority = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-rules-selection-authority.ts', import.meta.url),
  'utf8',
);
const docs = readFileSync(
  new URL('../docs/travelport-stays-rules-selection-authority.md', import.meta.url),
  'utf8',
);

test('Rules selection authority composes after existing public response guards and before the compatibility core', () => {
  assert.match(wrapper, /const referenceAuthorityFetch = createTravelportStaysReferenceAuthorityFetch\(authority\.fetchImpl \?\? fetch\)/);
  assert.match(wrapper, /const memberAuthorityFetch = createTravelportStaysRulesMemberAuthorityFetch\(referenceAuthorityFetch\)/);
  assert.match(wrapper, /fetchImpl: createTravelportStaysRulesSelectionAuthorityFetch\(memberAuthorityFetch\)/);
  assert.match(wrapper, /extends CoreTravelportStaysBookingTermsProvider/);
});

test('Rules request and response selection evidence is bound to source and exact product cardinality', () => {
  assert.match(authority, /const RULES_PATH = '\/11\/hotel\/rules\/offershospitality\/buildfromrequest'/);
  assert.match(authority, /hotelAggregator === 'Travelport'[\s\S]*\? 'TVPT'[\s\S]*hotelAggregator === 'Booking'[\s\S]*\? 'BKNG'/);
  assert.match(authority, /identifier\.authority !== expected\.rateAuthority/);
  assert.match(authority, /matchingProducts\.length !== 1/);
  assert.match(authority, /guests !== expected\.numberOfGuests/);
});

test('the selection contract stays read-only and documents the compatibility boundary', () => {
  assert.doesNotMatch(authority, /CardNumber|SeriesCode|PlainText|acceptPriceChangeInd|acceptGuaranteeChangeInd/);
  assert.match(docs, /missing response `Identifier` remains compatible/);
  assert.match(docs, /does not advertise Travelport `reservation`/);
  assert.match(docs, /live non-production evidence/);
});
