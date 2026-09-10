import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectTravelportStaysReservationReceiptEvidence } from './travelport-stays-reservation-receipt-evidence.ts';

function confirmation(input: Readonly<{
  receiptType?: unknown;
  confirmationType?: unknown;
  offerStatusType?: unknown;
  sourceContext?: unknown;
  locatorType?: unknown;
}>) {
  return {
    ...(input.receiptType === undefined ? {} : { '@type': input.receiptType }),
    Confirmation: {
      ...(input.confirmationType === undefined ? {} : { '@type': input.confirmationType }),
      Locator: {
        value: 'D6VBHL',
        ...(input.sourceContext === undefined ? {} : { sourceContext: input.sourceContext }),
        ...(input.locatorType === undefined ? {} : { locatorType: input.locatorType }),
      },
      OfferStatus: {
        ...(input.offerStatusType === undefined ? {} : { '@type': input.offerStatusType }),
        Status: 'Confirmed',
      },
    },
  };
}

function cancellation(input: Readonly<{
  cancellationType?: unknown;
  offerStatusType?: unknown;
  sourceContext?: unknown;
  locatorType?: unknown;
}>) {
  return {
    '@type': 'ReceiptCancellation',
    Cancellation: {
      ...(input.cancellationType === undefined ? {} : { '@type': input.cancellationType }),
      Locator: {
        value: 'CXL-123',
        ...(input.sourceContext === undefined ? {} : { sourceContext: input.sourceContext }),
        ...(input.locatorType === undefined ? {} : { locatorType: input.locatorType }),
      },
      OfferStatus: {
        ...(input.offerStatusType === undefined ? {} : { '@type': input.offerStatusType }),
        Status: 'Cancelled',
      },
    },
  };
}

test('rejects explicit null Stays locator identity instead of treating it as generic omission', () => {
  for (const receipt of [
    confirmation({ receiptType: 'ReceiptConfirmation', sourceContext: null }),
    confirmation({ receiptType: 'ReceiptConfirmation', locatorType: null }),
    confirmation({ receiptType: 'ReceiptConfirmation', sourceContext: null, locatorType: null }),
    cancellation({ sourceContext: null, offerStatusType: 'OfferStatusHospitality' }),
    cancellation({ locatorType: null, offerStatusType: 'OfferStatusHospitality' }),
    cancellation({ sourceContext: null, locatorType: null, offerStatusType: 'OfferStatusHospitality' }),
  ]) {
    assert.equal(inspectTravelportStaysReservationReceiptEvidence([receipt]).valid, false);
  }
});

test('rejects explicit null Stays receipt discriminators while preserving genuine omission compatibility', () => {
  for (const receipt of [
    confirmation({
      receiptType: null,
      confirmationType: 'ConfirmationHold',
      offerStatusType: 'OfferStatusHospitality',
      sourceContext: 'Travelport',
      locatorType: 'PNR Locator',
    }),
    confirmation({
      receiptType: 'ReceiptConfirmation',
      confirmationType: null,
      offerStatusType: 'OfferStatusHospitality',
      sourceContext: 'Travelport',
      locatorType: 'PNR Locator',
    }),
    confirmation({
      receiptType: 'ReceiptConfirmation',
      confirmationType: 'ConfirmationHold',
      offerStatusType: null,
      sourceContext: 'Travelport',
      locatorType: 'PNR Locator',
    }),
    cancellation({
      cancellationType: null,
      offerStatusType: 'OfferStatusHospitality',
      sourceContext: 'Supplier',
      locatorType: 'Cancellation Number',
    }),
    cancellation({
      cancellationType: 'CancellationHold',
      offerStatusType: null,
      sourceContext: 'Supplier',
      locatorType: 'Cancellation Number',
    }),
  ]) {
    assert.equal(inspectTravelportStaysReservationReceiptEvidence([receipt]).valid, false);
  }

  const omittedInnerTypes = inspectTravelportStaysReservationReceiptEvidence([
    confirmation({
      receiptType: 'ReceiptConfirmation',
      sourceContext: 'Travelport',
      locatorType: 'PNR Locator',
    }),
  ]);
  assert.equal(omittedInnerTypes.valid, true);
  assert.equal(omittedInnerTypes.travelportPnrReceipts[0]?.reference, 'D6VBHL');

  const genericSharedModel = inspectTravelportStaysReservationReceiptEvidence([
    confirmation({ receiptType: 'ReceiptConfirmation' }),
  ]);
  assert.equal(genericSharedModel.valid, true);
  assert.deepEqual(genericSharedModel.travelportPnrReceipts, []);
  assert.deepEqual(genericSharedModel.supplierConfirmationReceipts, []);
  assert.deepEqual(genericSharedModel.supplierCancellationReceipts, []);
});
