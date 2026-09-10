import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('commercial Travelport receipt authority is bound to offer scope', () => {
  const classifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');

  assert.match(classifier, /const MAX_OFFER_REFERENCE_LENGTH = 64/);
  assert.match(classifier, /matchedOfferId: string \| null/);
  assert.match(classifier, /offerCount: number/);
  assert.match(classifier, /const offerIds = new Set<string>\(\)/);
  assert.match(classifier, /offerId && offerIds\.has\(offerId\)/);
  assert.match(classifier, /function commercialReceiptScopeIsValid/);
  assert.match(classifier, /sourceContext === 'Travelport' && locatorType === 'PNR Locator'/);
  assert.match(classifier, /if \(rawOfferRefs === null\) return false/);
  assert.match(classifier, /if \(rawOfferRefs !== undefined\) return false/);
  assert.match(classifier, /if \(rawOfferRefs === undefined\)/);
  assert.match(classifier, /offerEvidence\.offerCount !== 1/);
  assert.match(classifier, /!Array\.isArray\(rawOfferRefs\) \|\| rawOfferRefs\.length !== 1/);
  assert.match(classifier, /if \(offerEvidence\.matchedOfferId\)[\s\S]*?offerRef !== offerEvidence\.matchedOfferId/);
  assert.match(classifier, /else if \(offerEvidence\.offerCount !== 1\)/);
  assert.match(classifier, /!commercialReceiptScopeIsValid\(reservation\.Receipt, offerEvidence\)/);

  const nullScopeRejection = classifier.indexOf('if (rawOfferRefs === null) return false;');
  const pnrPresenceRejection = classifier.indexOf('if (rawOfferRefs !== undefined) return false;');
  const supplierOmissionCompatibility = classifier.indexOf('if (rawOfferRefs === undefined) {');
  assert.ok(nullScopeRejection >= 0, 'commercial receipt scope must reject explicit null OfferRef');
  assert.ok(
    pnrPresenceRejection > nullScopeRejection,
    'Travelport PNR field-presence rejection must include explicit null before PNR acceptance',
  );
  assert.ok(
    supplierOmissionCompatibility > pnrPresenceRejection,
    'single-offer supplier compatibility must apply only to genuine OfferRef omission',
  );
});

test('commercial receipt scope keeps current single-offer Sync compatibility and capability disabled', () => {
  const doc = source('docs/travelport-commercial-receipt-scope.md');

  assert.match(doc, /Create Reservation/i);
  assert.match(doc, /Booking\.com Sync/i);
  assert.match(doc, /Travelport PNR.*reservation-level/i);
  assert.match(doc, /supplier confirmation.*OfferRef/i);
  assert.match(doc, /explicit `null`/i);
  assert.match(doc, /single-offer/i);
  assert.match(doc, /current Sync example.*without an `id`/i);
  assert.match(doc, /reservation.*remains disabled/i);
});
