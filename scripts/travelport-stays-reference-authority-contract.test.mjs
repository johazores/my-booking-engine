import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const decoder = readFileSync(new URL('../src/server/suppliers/travelport-stays-reference-decoder.ts', import.meta.url), 'utf8');
const provider = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-provider.ts', import.meta.url),
  'utf8',
);
const terms = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-booking-terms-provider.ts', import.meta.url),
  'utf8',
);
const commercial = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-commercial-authority.ts', import.meta.url),
  'utf8',
);

test('the public Travelport pricing adapter owns canonical supplier-reference authority', () => {
  assert.match(provider, /const ASCII_CONTROL_PATTERN = \/\[\\u0000-\\u001f\\u007f\]\//);
  assert.match(decoder, /bytes\.toString\('base64url'\) !== value/);
  assert.match(decoder, /hasExactKeys\(reference, PROPERTY_KEYS\)/);
  assert.match(decoder, /hasExactKeys\(reference, OFFER_KEYS\)/);
  assert.match(decoder, /rateValue\.isWellFormed\(\)/);
  assert.match(decoder, /ASCII_CONTROL_PATTERN\.test\(rateValue\)/);
  assert.match(provider, /export function assertTravelportStaysPropertyReference/);
  assert.match(provider, /export function assertTravelportStaysOfferReference/);
  assert.match(provider, /property\.authority !== 'TVPT'/);
  assert.match(provider, /exactMachineToken\(offer\.rateValue, MAX_REFERENCE_LENGTH, 'request'\)/);
  assert.match(provider, /assertTravelportStaysPropertyReference\(authority\.supplierPropertyReference\)/);
  assert.match(provider, /assertTravelportStaysOfferReference\(authority\.supplierOfferReference\)/);
  assert.match(provider, /exactMachineToken\(authority\.pageToken, MAX_REFERENCE_LENGTH, 'request'\)/);
});

test('provider responses are checked before the compatibility core can normalize machine evidence', () => {
  assert.match(provider, /createTravelportStaysReferenceAuthorityFetch/);
  assert.match(provider, /response\.clone\(\)\.json\(\)/);
  assert.match(provider, /validateSearchCompleteResponse\(payload, searchRequestAuthority\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(property\.chainCode, 16\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(property\.propertyCode, 32\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(rateKey\.value, MAX_REFERENCE_LENGTH\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(rate\.bookingCode, 512\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(rateCodeInfo\.rateCode, 256\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(rateCodeInfo\.ratePlanID, 256\)/);
  assert.match(provider, /exactResponseTokenIfPresent\(rateCodeInfo\.rateCategory, 128\)/);
  assert.match(provider, /validateCurrencyCodeIfPresent\(price\.currencyCode\)/);
  assert.match(provider, /validateCurrencyCodeIfPresent\(currencyAmount\.currency\)/);
  assert.match(provider, /exactMachineToken\(pagination\.paginationToken, MAX_REFERENCE_LENGTH, 'response'\)/);
});

test('transport authority protects configured credentials and OAuth bearer tokens before provider use', () => {
  assert.match(provider, /exactConfigurationValue\(authority\.username/);
  assert.match(provider, /exactConfigurationValue\(authority\.password/);
  assert.match(provider, /exactConfigurationValue\(authority\.clientId/);
  assert.match(provider, /exactConfigurationValue\(authority\.clientSecret/);
  assert.match(provider, /exactConfigurationValue\(authority\.accessGroup/);
  assert.match(provider, /isTravelportOAuthRequest/);
  assert.match(provider, /exactMachineToken\(object\.access_token, MAX_ACCESS_TOKEN_LENGTH, 'response'\)/);
  assert.match(provider, /requestTravelportStaysAccessTokenCore/);
  assert.match(provider, /probeTravelportStaysIntegrationHealthCore/);
});

test('commercial authority rejects normalized money and truncated terms before compatibility parsing', () => {
  assert.match(provider, /assertTravelportStaysSearchCommercialAuthorityResponse\(payload\)/);
  assert.match(provider, /assertTravelportStaysRulesCommercialAuthorityResponse\(payload\)/);
  assert.match(commercial, /function exactMoneyIfPresent/);
  assert.match(commercial, /MONEY_TEXT_PATTERN/);
  assert.match(commercial, /ASCII_CONTROL_PATTERN\.test\(text\)/);
  assert.match(commercial, /moneyComponent\(price\.totalPrice\)/);
  assert.match(commercial, /exactMoneyIfPresent\(price\.TotalPrice\)/);
  assert.match(commercial, /requiredDecimal\(penalty\.Percent, 'percent-penalty'\)/);
  assert.match(commercial, /requiredDecimal\(penalty\.Nights, 'nights-penalty'\)/);
  assert.match(commercial, /commercialTextIfPresent\(cancellation\.Description, MAX_CANCELLATION_DESCRIPTION\)/);
  assert.match(commercial, /commercialTextIfPresent\(formatted\.value, MAX_RULE_TEXT\)/);
  assert.match(commercial, /commercial text that would be truncated before authority fingerprinting/);
  assert.match(commercial, /boundedArray\(block\.DepositPolicy, MAX_DEPOSIT_POLICIES\)/);
});

test('Rules uses the same public authority boundary before delegating to the compatibility core', () => {
  assert.match(terms, /extends CoreTravelportStaysBookingTermsProvider/);
  assert.match(terms, /createTravelportStaysReferenceAuthorityFetch\(unicodeAuthorityFetch\)/);
  assert.match(terms, /assertTravelportStaysPropertyReference\(authority\.supplierPropertyReference\)/);
  assert.match(terms, /assertTravelportStaysOfferReference\(authority\.supplierOfferReference\)/);

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
