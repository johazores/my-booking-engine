import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('pricing wrapper forwards only materialized constructor authority', async () => {
  const sourceText = await source('src/server/suppliers/travelport-stays-provider.ts');
  assert.match(sourceText, /materializeTravelportStaysProviderConstructorAuthority\(input\)/);
  assert.match(sourceText, /credentials: authority\.credentials/);
  assert.match(sourceText, /cacheKey: authority\.cacheKey/);
  assert.match(sourceText, /authority\.fetchImpl \?\? fetch/);
  assert.doesNotMatch(sourceText, /super\(\{\s*\.\.\.input/s);
});

test('Rules wrapper forwards only materialized constructor authority', async () => {
  const sourceText = await source('src/server/suppliers/travelport-stays-booking-terms-provider.ts');
  assert.match(sourceText, /materializeTravelportStaysBookingTermsConstructorAuthority\(input\)/);
  assert.match(sourceText, /credentials: authority\.credentials/);
  assert.match(sourceText, /cacheKey: authority\.cacheKey/);
  assert.match(sourceText, /pricingProvider: authority\.pricingProvider/);
  assert.match(sourceText, /authority\.fetchImpl \?\? fetch/);
  assert.doesNotMatch(sourceText, /super\(\{\s*\.\.\.input/s);
});

test('reservation-authority wrapper validates and forwards the same materialized cache key', async () => {
  const sourceText = await source('src/server/suppliers/travelport-stays-reservation-authority-provider.ts');
  assert.match(sourceText, /materializeTravelportStaysReservationAuthorityConstructorAuthority\(input\)/);
  assert.match(sourceText, /assertTravelportStaysReservationAuthorityCacheKey\(authority\.cacheKey\)/);
  assert.match(sourceText, /cacheKey: authority\.cacheKey/);
  assert.match(sourceText, /bookingTermsProvider: authority\.bookingTermsProvider/);
  assert.doesNotMatch(sourceText, /assertTravelportStaysReservationAuthorityCacheKey\(input\.cacheKey\)/);
  assert.doesNotMatch(sourceText, /super\(\{\s*\.\.\.input/s);
});

test('shared constructor materializer copies and freezes credential authority and sanitizes caller failures', async () => {
  const authority = await source('src/server/suppliers/travelport-stays-constructor-authority.ts');
  const docs = await source('docs/travelport-stays-constructor-authority.md');

  for (const field of ['environment', 'username', 'password', 'clientId', 'clientSecret', 'accessGroup']) {
    assert.match(authority, new RegExp(`${field}: credentials\\.${field}`));
  }
  assert.match(authority, /materializeTravelportStaysProviderConstructorAuthority/);
  assert.match(authority, /Object\.freeze\(\{\s*credentials: credentialsSnapshot\(input\.credentials\)/s);
  assert.match(authority, /catch \{\s*invalidConstructorAuthority\(\);\s*\}/s);
  assert.match(docs, /pricing.*Rules.*reservation-authority adapters are long-lived provider objects/is);
  assert.match(docs, /does not enable.*reservation/i);
});
