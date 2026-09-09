import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectTravelportStaysReservationReceiptEvidence } from './travelport-stays-reservation-receipt-evidence.ts';

function cancellation(input: Readonly<{
  value: unknown;
  locatorType?: unknown;
  sourceContext?: unknown;
  source?: unknown;
  cancellationType?: unknown;
  offerStatusType?: unknown;
  status?: unknown;
}>) {
  const hasOfferStatus = input.offerStatusType !== undefined || input.status !== undefined;
  return {
    '@type': 'ReceiptCancellation',
    Cancellation: {
      ...(input.cancellationType === undefined ? {} : { '@type': input.cancellationType }),
      Locator: {
        value: input.value,
        ...(input.locatorType === undefined ? {} : { locatorType: input.locatorType }),
        ...(input.sourceContext === undefined ? {} : { sourceContext: input.sourceContext }),
        ...(input.source === undefined ? {} : { source: input.source }),
      },
      ...(hasOfferStatus
        ? {
            OfferStatus: {
              ...(input.offerStatusType === undefined ? {} : { '@type': input.offerStatusType }),
              ...(input.status === undefined ? {} : { Status: input.status }),
            },
          }
        : {}),
    },
  };
}

test('captures self-identifying Stays ReceiptCancellation as cancellation lifecycle evidence', () => {
  for (const receipt of [
    cancellation({
      value: '0GQ9HS',
      locatorType: 'PNR Locator',
      sourceContext: 'Travelport',
      source: '1G',
      cancellationType: 'CancellationHold',
      offerStatusType: 'OfferStatusHospitality',
      status: 'Cancelled',
    }),
    cancellation({
      value: 'CNCL-4482',
      locatorType: 'Cancellation Number',
      sourceContext: 'Supplier',
      source: 'BO',
      cancellationType: 'CancellationHold',
      status: 'Cancelled',
    }),
    cancellation({
      value: 'GENERIC-HOTEL-CANCEL',
      source: '1G',
      cancellationType: 'CancellationHold',
      offerStatusType: 'OfferStatusHospitality',
      status: 'Cancelled',
    }),
  ]) {
    const result = inspectTravelportStaysReservationReceiptEvidence([receipt]);
    assert.equal(result.valid, true);
    assert.equal(result.supplierCancellationReceipts.length, 1);
    assert.equal(result.travelportPnrReceipts.length, 0);
    assert.equal(result.supplierConfirmationReceipts.length, 0);
  }
});

test('keeps unrelated shared-model ReceiptCancellation outside Stays authority', () => {
  const result = inspectTravelportStaysReservationReceiptEvidence([
    cancellation({
      value: 'FBYU87',
      source: '1A',
      cancellationType: 'CancellationHold',
    }),
    cancellation({
      value: 'AA001HGO3HWA4',
      sourceContext: 'OrderId',
      source: 'AA',
      cancellationType: 'CancellationHold',
      offerStatusType: 'OfferStatusAir',
    }),
    cancellation({
      value: '0GM4S1',
      locatorType: 'Locator',
      sourceContext: 'Travelport',
      source: '1G',
      cancellationType: 'CancellationHold',
    }),
  ]);

  assert.equal(result.valid, true);
  assert.deepEqual(result.supplierCancellationReceipts, []);
});

test('fails closed when a Stays-owned cancellation context omits locatorType', () => {
  for (const sourceContext of ['Travelport', 'Supplier', 'Agency']) {
    const result = inspectTravelportStaysReservationReceiptEvidence([
      cancellation({
        value: 'PARTIAL-STAYS-CANCEL',
        sourceContext,
        cancellationType: 'CancellationHold',
      }),
    ]);

    assert.equal(result.valid, false, `${sourceContext} cancellation context must not be silently ignored`);
  }
});

test('fails closed on contradictory or malformed Stays ReceiptCancellation evidence', () => {
  for (const receipt of [
    cancellation({
      value: '0GQ9HS',
      locatorType: 'PNR Locator',
      sourceContext: 'Travelport',
      cancellationType: 'WrongCancellationType',
      status: 'Cancelled',
    }),
    cancellation({
      value: '0GQ9HS',
      locatorType: 'PNR Locator',
      sourceContext: 'Travelport',
      cancellationType: 'CancellationHold',
      offerStatusType: 'OfferStatusAir',
      status: 'Cancelled',
    }),
    cancellation({
      value: '0GQ9HS',
      locatorType: 'PNR Locator',
      sourceContext: 'Travelport',
      cancellationType: 'CancellationHold',
      offerStatusType: 'OfferStatusHospitality',
      status: 'Confirmed',
    }),
    cancellation({
      value: '0GQ9HS',
      locatorType: 'PNR Locator',
      cancellationType: 'CancellationHold',
      offerStatusType: 'OfferStatusHospitality',
      status: 'Cancelled',
    }),
    cancellation({
      value: '4619',
      locatorType: 'Pin code',
      sourceContext: 'Supplier',
      source: 'BO',
      cancellationType: 'CancellationHold',
      offerStatusType: 'OfferStatusHospitality',
      status: 'Cancelled',
    }),
    cancellation({
      value: 'AA001HGO3HWA4',
      sourceContext: 'OrderId',
      source: 'AA',
      cancellationType: 'CancellationHold',
      offerStatusType: 'OfferStatusHospitality',
      status: 'Cancelled',
    }),
    cancellation({
      value: 'GENERIC-HOTEL-CANCEL',
      source: '1G',
      cancellationType: 'CancellationHold',
      offerStatusType: 'OfferStatusHospitality',
    }),
    cancellation({
      value: 'BAD\nCANCEL',
      locatorType: 'Cancellation Number',
      sourceContext: 'Supplier',
      cancellationType: 'CancellationHold',
      offerStatusType: 'OfferStatusHospitality',
      status: 'Cancelled',
    }),
  ]) {
    assert.equal(inspectTravelportStaysReservationReceiptEvidence([receipt]).valid, false);
  }
});
