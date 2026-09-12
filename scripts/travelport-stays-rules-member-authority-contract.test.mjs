import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-booking-terms-provider.ts', import.meta.url),
  'utf8',
);
const authority = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-rules-member-authority.ts', import.meta.url),
  'utf8',
);
const docs = readFileSync(
  new URL('../docs/travelport-stays-commercial-member-authority.md', import.meta.url),
  'utf8',
);

test('Rules member authority runs after the existing public reference/commercial guard and before the compatibility core', () => {
  assert.match(wrapper, /const referenceAuthorityFetch = createTravelportStaysReferenceAuthorityFetch\(authority\.fetchImpl \?\? fetch\)/);
  assert.match(wrapper, /fetchImpl: createTravelportStaysRulesMemberAuthorityFetch\(referenceAuthorityFetch\)/);
  assert.match(wrapper, /extends CoreTravelportStaysBookingTermsProvider/);
});

test('present accepted-card and formatted-text members require primary commercial values', () => {
  assert.match(authority, /requiredPaymentCardCode\(card\.value\)/);
  assert.match(authority, /value\.length !== PAYMENT_CARD_CODE_LENGTH/);
  assert.match(authority, /textBlock\.TextFormatted\.length < 1/);
  assert.match(authority, /requiredCommercialText\(formatted\.value, MAX_RULE_TEXT, 'Rules formatted-text'\)/);
  assert.match(authority, /if \(!normalized\)/);
});

test('the contract remains read-only and documents the closed reservation boundary', () => {
  assert.doesNotMatch(authority, /CardNumber|PlainText|SeriesCode|acceptPriceChangeInd|acceptGuaranteeChangeInd/);
  assert.match(docs, /does not advertise Travelport `reservation`/);
  assert.match(docs, /PCI-safe FormOfPayment\/guarantee source/);
  assert.match(docs, /missing accepted-card `value` is currently skipped/);
  assert.match(docs, /empty or missing formatted-text `value` is currently ignored/);
});
