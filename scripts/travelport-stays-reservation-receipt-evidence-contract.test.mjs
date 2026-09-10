import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function source(path) {
  return fs.readFileSync(path, 'utf8');
}

test('Travelport reservation lifecycle shares one fail-closed Stays receipt evidence boundary', () => {
  const helper = source('src/server/suppliers/travelport-stays-reservation-receipt-evidence.ts');
  const retrieve = source('src/server/suppliers/travelport-stays-reservation-response.ts');
  const create = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');

  assert.match(retrieve, /inspectTravelportStaysReservationReceiptEvidence\(receiptInput\)/);
  assert.match(retrieve, /const offerScope = assertExpectedReservationMatch\(reservation, input\.expectedReservation\)/);
  assert.match(retrieve, /const offerIds = new Set<string>\(\)/);
  assert.match(retrieve, /const passiveOfferIds = new Set<string>\(\)/);
  assert.match(retrieve, /activeHospitalityOfferId: string/);
  assert.match(retrieve, /activeHospitalityOfferId = offerId/);
  assert.match(retrieve, /const offerType = boundedProviderValue\(offer\['@type'\], MAX_OFFER_TYPE_LENGTH\)/);
  assert.match(retrieve, /if \(offerType !== 'Offer'\)/);
  assert.match(retrieve, /!offerId \|\| offerIds\.has\(offerId\)/);
  assert.match(retrieve, /const normalizedOfferRefs = offerRefs\.filter/);
  assert.match(retrieve, /normalizedOfferRefs\.some\(\(offerRef\) => !offerScope\.offerIds\.has\(offerRef\)\)/);
  assert.match(retrieve, /new Set\(normalizedOfferRefs\)\.size !== normalizedOfferRefs\.length/);
  assert.match(retrieve, /unknown offer/i);
  assert.match(retrieve, /mixed active and passive offer references in one receipt/i);
  assert.match(retrieve, /supplier receipt evidence without active hotel offer scope/i);
  assert.match(retrieve, /supplier receipt evidence outside the active hotel offer/i);
  assert.match(retrieve, /normalizedOfferRefs\.length !== 1[\s\S]*?normalizedOfferRefs\[0\] !== offerScope\.activeHospitalityOfferId/);
  assert.match(retrieve, /isDocumentedPassivePlaceholderReceipt\(receipt\)/);
  assert.match(retrieve, /offerStatus\.code === 'AK'/);
  assert.match(retrieve, /offerStatus\.Status === 'Confirmed'/);
  assert.match(retrieve, /const passiveReceiptEvidence = inspectTravelportStaysReservationReceiptEvidence\(\[receipt\]\)/);
  assert.match(retrieve, /if \(!passiveReceiptEvidence\.valid\)/);
  assert.match(retrieve, /passiveReceiptEvidence\.travelportPnrReceipts\.length > 0/);
  assert.match(retrieve, /passiveReceiptEvidence\.supplierConfirmationReceipts\.length > 0/);
  assert.match(retrieve, /passiveReceiptEvidence\.supplierCancellationReceipts\.length > 0/);
  assert.match(retrieve, /if \(hasPassiveReservationAuthority\)[\s\S]*?return false;/);
  assert.match(retrieve, /malformed passive reservation receipt evidence/i);
  assert.doesNotMatch(retrieve, /function isSupplierConfirmationReceipt/);
  assert.match(create, /inspectTravelportStaysReservationReceiptEvidence\(reservation\.Receipt\)/);
  assert.match(helper, /receiptType === 'ReceiptPayment'/);
  assert.match(helper, /receiptType === 'ReceiptCancellation'[\s\S]*inspectCancellationReceipt\(receipt\)/);
  assert.match(helper, /cancellationType !== 'CancellationHold'/);
  assert.match(helper, /offerStatusType !== null && offerStatusType !== 'OfferStatusHospitality'/);
  assert.match(helper, /!status \|\| status !== 'Cancelled'/);
  assert.match(helper, /isStaysSourceContext\(sourceContext\)/);
  assert.match(helper, /const hasStaysLocatorType = isStaysLocatorType\(locatorType\)/);
  assert.match(helper, /const hasCanonicalStaysPair = isCanonicalStaysPair\(sourceContext, locatorType\)/);
  assert.match(helper, /if \(hasStaysSourceContext && !hasLocatorType\)/);
  assert.match(helper, /if \(hasStaysLocatorType && !hasCanonicalStaysPair\)/);
  assert.match(helper, /const relevant = hasCanonicalStaysPair \|\| hasHospitalityStatus/);
  assert.match(helper, /const hasSupportedStaysPair = hasCanonicalStaysPair[\s\S]*sourceContext === 'Supplier' && locatorType === 'Pin code'/);
  assert.match(helper, /if \(\(hasStaysSourceContext \|\| hasStaysLocatorType\) && !hasSupportedStaysPair\)/);
  assert.match(helper, /confirmationType !== 'ConfirmationHold'/);
  assert.match(helper, /offerStatusType !== 'OfferStatusHospitality'/);
  assert.match(helper, /if \(!hasSourceContext && !hasLocatorType\)/);
  assert.match(helper, /supplierCancellationReceipts\.push\(cancellation\.receipt\)/);
  assert.match(create, /(?:evidence|receiptEvidence)\.supplierCancellationReceipts\.length > 0/);
  assert.match(retrieve, /(?:evidence|receiptEvidence)\.supplierCancellationReceipts\.length > 0/);

  assert.equal(
    (helper.match(/const hasSourceContext = rawSourceContext !== undefined;/g) ?? []).length,
    2,
    'confirmation and cancellation locators must treat explicit null sourceContext as present malformed evidence',
  );
  assert.equal(
    (helper.match(/const hasLocatorType = rawLocatorType !== undefined;/g) ?? []).length,
    2,
    'confirmation and cancellation locators must treat explicit null locatorType as present malformed evidence',
  );
  assert.doesNotMatch(helper, /rawSourceContext !== undefined\s*&&\s*rawSourceContext !== null/);
  assert.doesNotMatch(helper, /rawLocatorType !== undefined\s*&&\s*rawLocatorType !== null/);
  assert.match(helper, /if \(rawReceiptType !== undefined\)/);
  assert.match(helper, /requireHospitalityDiscriminators && rawConfirmationType !== undefined/);
  assert.match(helper, /requireHospitalityDiscriminators && rawOfferStatusType !== undefined/);
  assert.match(helper, /if \(rawCancellationType !== undefined\)/);
  assert.match(helper, /const offerStatusType = rawOfferStatusType === undefined/);

  assert.doesNotMatch(helper, /CardNumber|SeriesCode|PaymentCard|FormOfPayment/);
});
