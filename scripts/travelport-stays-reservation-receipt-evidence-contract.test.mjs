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

  assert.match(retrieve, /inspectTravelportStaysReservationReceiptEvidence\(reservation\.Receipt\)/);
  assert.match(create, /inspectTravelportStaysReservationReceiptEvidence\(reservation\.Receipt\)/);
  assert.match(helper, /receiptType === 'ReceiptPayment' \|\| receiptType === 'ReceiptCancellation'/);
  assert.match(helper, /sourceContext === 'Travelport' \|\| sourceContext === 'Supplier' \|\| sourceContext === 'Agency'/);
  assert.match(helper, /const hasStaysSourceContext = sourceContext === 'Travelport' \|\| sourceContext === 'Supplier' \|\| sourceContext === 'Agency'/);
  assert.match(helper, /const hasStaysLocatorType = locatorType === 'PNR Locator'[\s\S]*locatorType === 'Confirmation Number'[\s\S]*locatorType === 'Cancellation Number'[\s\S]*locatorType === 'IATA Number'[\s\S]*locatorType === 'Pin code'/);
  assert.match(helper, /const hasCanonicalStaysPair = \(sourceContext === 'Travelport' && locatorType === 'PNR Locator'\)[\s\S]*sourceContext === 'Supplier' && locatorType === 'Confirmation Number'[\s\S]*sourceContext === 'Supplier' && locatorType === 'Cancellation Number'[\s\S]*sourceContext === 'Agency' && locatorType === 'IATA Number'/);
  assert.match(helper, /const hasSupportedStaysPair = hasCanonicalStaysPair[\s\S]*sourceContext === 'Supplier' && locatorType === 'Pin code'/);
  assert.match(helper, /if \(\(hasStaysSourceContext \|\| hasStaysLocatorType\) && !hasSupportedStaysPair\)/);
  assert.match(helper, /confirmationType !== 'ConfirmationHold'/);
  assert.match(helper, /offerStatusType !== 'OfferStatusHospitality'/);
  assert.match(helper, /if \(!hasSourceContext && !hasLocatorType\)/);
  assert.match(create, /(?:evidence|receiptEvidence)\.supplierCancellationReceipts\.length > 0/);
  assert.match(retrieve, /(?:evidence|receiptEvidence)\.supplierCancellationReceipts\.length > 0/);
  assert.doesNotMatch(helper, /CardNumber|SeriesCode|PaymentCard|FormOfPayment/);
});
