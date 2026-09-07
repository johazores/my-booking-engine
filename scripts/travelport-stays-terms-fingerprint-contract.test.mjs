import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Travelport Rules durable fingerprint excludes volatile observation metadata and remains wired into normalization', () => {
  const provider = source('src/server/suppliers/travelport-stays-booking-terms-provider.ts');
  const fingerprint = source('src/server/suppliers/travelport-stays-booking-terms-fingerprint.ts');
  const authority = source('src/server/suppliers/travelport-stays-reservation-authority-provider.ts');
  const docs = source('docs/travelport-terms-fingerprint-authority.md');

  assert.match(provider, /fingerprintTravelportStaysBookingTerms/);
  assert.match(provider, /termsFingerprint:\s*fingerprintTravelportStaysBookingTerms\(normalized\)/);
  assert.match(provider, /Object\.freeze\(\[\.\.\.new Set\(guarantees\)\]\.sort\(\)\)/);

  assert.doesNotMatch(fingerprint, /value\.observedAt/);
  assert.doesNotMatch(fingerprint, /value\.revalidationRequired/);
  for (const field of [
    'supplierPropertyReference',
    'supplierOfferReference',
    'price',
    'paymentTiming',
    'guaranteeTypes',
    'acceptedPaymentCardCodes',
    'cancellationRules',
    'deposits',
    'completeForReservationReview',
  ]) {
    assert.match(fingerprint, new RegExp(`value\\.${field}`));
  }
  assert.match(fingerprint, /guaranteeTypes:\s*\[\.\.\.value\.guaranteeTypes\]\.sort\(\)/);
  assert.match(fingerprint, /acceptedPaymentCardCodes:\s*\[\.\.\.value\.acceptedPaymentCardCodes\]\.sort\(\)/);

  assert.match(authority, /reviewed\.bookingTerms\.termsFingerprint\s*!==\s*normalized\.expectedTermsFingerprint/);
  assert.match(docs, /observation timestamp/i);
  assert.match(docs, /not guessed or backfilled/i);
});
