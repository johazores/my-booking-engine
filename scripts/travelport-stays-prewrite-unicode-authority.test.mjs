import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const boundary = source('src/server/suppliers/travelport-stays-json-unicode-authority.ts');
const bookingTerms = source('src/server/suppliers/travelport-stays-booking-terms-provider.ts');
const reservationAuthority = source('src/server/suppliers/travelport-stays-reservation-authority-provider.ts');
const docs = source('docs/travelport-stays-prewrite-unicode-authority.md');
const reservationUnicodeDocs = source('docs/travelport-reservation-unicode-authority.md');

test('pre-write Unicode boundary is scoped to the current Travelport Stays JSON authority routes', () => {
  assert.match(boundary, /api\.pp\.travelport\.net/);
  assert.match(boundary, /api\.travelport\.net/);
  assert.match(boundary, /\/12\/hotel\/search\/searchcomplete/);
  assert.match(boundary, /\/11\/hotel\/rules\/offershospitality\/buildfromrequest/);
  assert.match(boundary, /\/11\/hotel\/availability\/catalogofferingshospitality/);
  assert.match(boundary, /\.isWellFormed\(\)/);
  assert.match(boundary, /INVALID_REQUEST/);
  assert.match(boundary, /INVALID_RESPONSE/);
});

test('Rules authority composes Unicode validation before existing provider response guards', () => {
  const unicodeIndex = bookingTerms.indexOf('createTravelportStaysPreWriteUnicodeAuthorityFetch(');
  const referenceIndex = bookingTerms.indexOf('createTravelportStaysReferenceAuthorityFetch(unicodeAuthorityFetch)');
  const memberIndex = bookingTerms.indexOf('createTravelportStaysRulesMemberAuthorityFetch(referenceAuthorityFetch)');
  const selectionIndex = bookingTerms.indexOf('createTravelportStaysRulesSelectionAuthorityFetch(memberAuthorityFetch)');
  assert.ok(unicodeIndex >= 0 && referenceIndex > unicodeIndex && memberIndex > referenceIndex && selectionIndex > memberIndex);
});

test('SearchComplete and Availability reservation authority share the same Unicode boundary', () => {
  const unicodeIndex = reservationAuthority.indexOf('createTravelportStaysPreWriteUnicodeAuthorityFetch(');
  const responseIndex = reservationAuthority.indexOf('createTravelportStaysReservationAuthorityResponseFetch(\n      unicodeAuthorityFetch,');
  const selectionIndex = reservationAuthority.indexOf('createTravelportStaysAvailabilitySelectionAuthorityFetch(responseAuthorityFetch)');
  assert.ok(unicodeIndex >= 0 && responseIndex > unicodeIndex && selectionIndex > responseIndex);
  assert.match(docs, /well-formed non-BMP/);
  assert.match(docs, /does not advertise or enable the `reservation` capability/);
  assert.match(docs, /PCI-safe FormOfPayment\/guarantee source/);
  assert.match(docs, /`13034` \/ locator-less correlation/);
  assert.match(reservationUnicodeDocs, /travelport-stays-prewrite-unicode-authority\.md/);
});
