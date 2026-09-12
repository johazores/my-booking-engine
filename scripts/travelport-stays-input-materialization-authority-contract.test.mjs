import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Travelport public pricing adapter materializes caller-owned authority before validation/core use', async () => {
  const provider = await source('src/server/suppliers/travelport-stays-provider.ts');

  assert.match(provider, /materializeTravelportStaysSearchPageInput\(input\)/);
  assert.match(provider, /materializeTravelportStaysOfferSearchInput\(input\)/);
  assert.match(provider, /materializeTravelportStaysOfferRevalidationInput\(input\)/);
  assert.match(provider, /super\.searchPropertiesPage\(authority\)/);
  assert.match(provider, /super\.searchPropertyOffers\(authority\)/);
  assert.match(provider, /super\.revalidatePropertyOffer\(authority\)/);
  assert.doesNotMatch(provider, /super\.revalidatePropertyOffer\(input\)/);
});

test('Rules and reservation-authority adapters forward only materialized snapshots', async () => {
  const bookingTerms = await source('src/server/suppliers/travelport-stays-booking-terms-provider.ts');
  const reservationAuthority = await source('src/server/suppliers/travelport-stays-reservation-authority-provider.ts');

  assert.match(bookingTerms, /materializeTravelportStaysOfferRevalidationInput\(input\)/);
  assert.match(bookingTerms, /super\.retrieveBookingTerms\(authority\)/);
  assert.doesNotMatch(bookingTerms, /super\.retrieveBookingTerms\(input\)/);

  assert.match(reservationAuthority, /materializeTravelportStaysReservationAuthorityInput\(input\)/);
  assert.match(reservationAuthority, /super\.verifyReservationAuthority\(authority\)/);
  assert.doesNotMatch(reservationAuthority, /super\.verifyReservationAuthority\(input\)/);
});

test('shared materialization contract is one-read, bounded, frozen, and fail-closed', async () => {
  const authority = await source('src/server/suppliers/travelport-stays-input-materialization.ts');
  const docs = await source('docs/travelport-stays-input-materialization-authority.md');

  assert.match(authority, /const MAX_CHILDREN = 8/);
  assert.match(authority, /Object\.freeze\(childAges\)/);
  assert.match(authority, /Object\.freeze\(readOfferSearchInput\(input\)\)/);
  assert.match(authority, /supplierOfferReference: input\.supplierOfferReference/);
  assert.match(authority, /expectedTermsFingerprint: input\.expectedTermsFingerprint/);
  assert.match(authority, /catch \{\s*invalidMaterialization\(\);\s*\}/s);
  assert.match(docs, /read exactly once/i);
  assert.match(docs, /before adapter validation/i);
  assert.match(docs, /reservation.*remains deliberately disabled/i);
});
