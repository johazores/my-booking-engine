import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const provider = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-provider.ts', import.meta.url),
  'utf8',
);
const terms = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-booking-terms-provider.ts', import.meta.url),
  'utf8',
);

test('the public Travelport pricing adapter owns canonical supplier-reference authority', () => {
  assert.match(provider, /const ASCII_CONTROL_PATTERN = \/\[\\u0000-\\u001f\\u007f\]\//);
  assert.match(provider, /bytes\.toString\('base64url'\) !== value/);
  assert.match(provider, /export function assertTravelportStaysPropertyReference/);
  assert.match(provider, /export function assertTravelportStaysOfferReference/);
  assert.match(provider, /property\.authority !== 'TVPT'/);
  assert.match(provider, /exactMachineToken\(offer\.rateValue, MAX_REFERENCE_LENGTH, 'request'\)/);
  assert.match(provider, /assertTravelportStaysPropertyReference\(input\.supplierPropertyReference\)/);
  assert.match(provider, /assertTravelportStaysOfferReference\(input\.supplierOfferReference\)/);
  assert.match(provider, /ASCII_CONTROL_PATTERN\.test\(input\.pageToken\)/);
});

test('provider responses are checked before the compatibility core can normalize machine evidence', () => {
  assert.match(provider, /createTravelportStaysReferenceAuthorityFetch/);
  assert.match(provider, /response\.clone\(\)\.json\(\)/);
  assert.match(provider, /validateSearchCompleteResponse\(payload\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(property\.chainCode, 16\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(property\.propertyCode, 32\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(rateKey\.value, MAX_REFERENCE_LENGTH\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(rate\.bookingCode, 512\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(rateCodeInfo\.rateCode, 256\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(rateCodeInfo\.ratePlanID, 256\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(rateCodeInfo\.rateCategory, 128\)/);
  assert.match(provider, /validateCurrencyCodeIfPresent\(price\.currencyCode\)/);
  assert.match(provider, /validateCurrencyCodeIfPresent\(currencyAmount\.currency\)/);
  assert.match(provider, /ASCII_CONTROL_PATTERN\.test\(pagination\.paginationToken\)/);
});

test('Rules uses the same public authority boundary before delegating to the compatibility core', () => {
  assert.match(terms, /extends CoreTravelportStaysBookingTermsProvider/);
  assert.match(terms, /createTravelportStaysReferenceAuthorityFetch\(input\.fetchImpl \?\? fetch\)/);
  assert.match(terms, /assertTravelportStaysPropertyReference\(input\.supplierPropertyReference\)/);
  assert.match(terms, /assertTravelportStaysOfferReference\(input\.supplierOfferReference\)/);

  assert.match(provider, /validateRulesResponse\(payload\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(card\.value, 16\)/);
  assert.match(provider, /validateCurrencyCodeIfPresent\(currencyCode\.value\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(product\.bookingCode, 512\)/);
});

test('legacy implementation blobs are isolated behind kebab-case compatibility modules', () => {
  assert.match(provider, /from '\.\/travelport-stays-provider-core\.ts'/);
  assert.match(terms, /from '\.\/travelport-stays-booking-terms-provider-core\.ts'/);
  assert.doesNotMatch(provider, /export \* from '\.\/travelport-stays-provider-core\.ts'/);
});
