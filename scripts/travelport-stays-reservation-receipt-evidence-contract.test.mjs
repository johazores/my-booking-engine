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

  assert.match(retrieve, /inspectTravelportStaysReservationReceiptEvidence\([\s\S]*activeReservationReceiptEvidence\(reservation\.Receipt, passiveOfferIds\)[\s\S]*\)/);
  assert.match(retrieve, /explicitPassiveOfferIds\(reservation\)/);
  assert.match(retrieve, /receipt\.OfferRef/);
  assert.match(retrieve, /passiveOfferIds\.has\(offerRef!\)/);
  assert.match(retrieve, /mixed active and passive offer references in one receipt/i);
  assert.match(retrieve, /isDocumentedPassivePlaceholderReceipt\(receipt\)/);
  assert.match(retrieve, /offerStatus\.code === 'AK'/);
  assert.match(retrieve, /offerStatus\.Status === 'Confirmed'/);
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
  assert.doesNotMatch(helper, /CardNumber|SeriesCode|PaymentCard|FormOfPayment/);
});
