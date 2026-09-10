import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectTravelportStaysReservationReceiptEvidence } from './travelport-stays-reservation-receipt-evidence.ts';

function travelportPnr() {
  return {
    '@type': 'ReceiptConfirmation',
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: '0GQ9HS',
        locatorType: 'PNR Locator',
        sourceContext: 'Travelport',
      },
      OfferStatus: {
        '@type': 'OfferStatusHospitality',
        Status: 'Confirmed',
      },
    },
  };
}

function genericConfirmation(input: Readonly<{
  statusType: string;
  sourceContext?: string;
  locatorType?: string;
}>) {
  return {
    '@type': 'ReceiptConfirmation',
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: 'GENERIC-LOCATOR',
        ...(input.sourceContext === undefined ? {} : { sourceContext: input.sourceContext }),
        ...(input.locatorType === undefined ? {} : { locatorType: input.locatorType }),
      },
      OfferStatus: {
        '@type': input.statusType,
        ...(input.statusType === 'OfferStatusAir'
          ? { StatusAir: [{ value: 'Confirmed' }] }
          : { Status: 'Confirmed' }),
      },
    },
  };
}

function genericCancellation(input: Readonly<{
  statusType: string;
  sourceContext?: string;
  locatorType?: string;
}>) {
  return {
    '@type': 'ReceiptCancellation',
    Cancellation: {
      '@type': 'CancellationHold',
      Locator: {
        value: 'GENERIC-CANCELLATION',
        ...(input.sourceContext === undefined ? {} : { sourceContext: input.sourceContext }),
        ...(input.locatorType === undefined ? {} : { locatorType: input.locatorType }),
      },
      OfferStatus: {
        '@type': input.statusType,
        ...(input.statusType === 'OfferStatusAir'
          ? { StatusAir: [{ value: 'Cancelled' }] }
          : { Status: 'Cancelled' }),
      },
    },
  };
}

test('accepts canonical Travelport Stays hospitality status evidence', () => {
  const evidence = inspectTravelportStaysReservationReceiptEvidence([travelportPnr()]);

  assert.equal(evidence.valid, true);
  assert.equal(evidence.travelportPnrReceipts[0]?.reference, '0GQ9HS');
});

test('does not let confirmation hospitality status evidence disappear when Stays locator identity is omitted', () => {
  for (const statusType of ['OfferStatusHospitality', ' OfferStatusHospitality', 'OfferStatusHospitality ']) {
    const evidence = inspectTravelportStaysReservationReceiptEvidence([
      genericConfirmation({ statusType }),
      travelportPnr(),
    ]);

    assert.equal(evidence.valid, false);
  }
});

test('rejects confirmation hospitality status evidence paired with a non-Stays locator family', () => {
  for (const receipt of [
    genericConfirmation({
      statusType: 'OfferStatusHospitality',
      sourceContext: 'Carrier',
      locatorType: 'Vendor Locator',
    }),
    genericConfirmation({
      statusType: 'OfferStatusHospitality',
      sourceContext: 'Carrier',
    }),
  ]) {
    const evidence = inspectTravelportStaysReservationReceiptEvidence([receipt, travelportPnr()]);
    assert.equal(evidence.valid, false);
  }
});

test('accepts canonical Stays ReceiptCancellation hospitality status evidence', () => {
  const evidence = inspectTravelportStaysReservationReceiptEvidence([
    genericCancellation({
      statusType: 'OfferStatusHospitality',
      sourceContext: 'Supplier',
      locatorType: 'Cancellation Number',
    }),
  ]);

  assert.equal(evidence.valid, true);
  assert.equal(evidence.supplierCancellationReceipts[0]?.reference, 'GENERIC-CANCELLATION');
  assert.equal(evidence.supplierCancellationReceipts[0]?.status, 'Cancelled');
});

test('does not let cancellation hospitality status evidence disappear when Stays locator identity is omitted', () => {
  for (const statusType of ['OfferStatusHospitality', ' OfferStatusHospitality', 'OfferStatusHospitality ']) {
    const evidence = inspectTravelportStaysReservationReceiptEvidence([
      genericCancellation({ statusType }),
      travelportPnr(),
    ]);

    assert.equal(evidence.valid, false);
  }
});

test('rejects cancellation hospitality status evidence paired with a partial or non-Stays locator family', () => {
  for (const receipt of [
    genericCancellation({
      statusType: 'OfferStatusHospitality',
      sourceContext: 'Carrier',
      locatorType: 'Vendor Locator',
    }),
    genericCancellation({
      statusType: 'OfferStatusHospitality',
      sourceContext: 'Carrier',
    }),
    genericCancellation({
      statusType: 'OfferStatusHospitality',
      locatorType: 'Vendor Locator',
    }),
  ]) {
    const evidence = inspectTravelportStaysReservationReceiptEvidence([receipt, travelportPnr()]);
    assert.equal(evidence.valid, false);
  }
});

test('preserves unrelated air confirmation and cancellation status evidence in multi-content reservations', () => {
  const evidence = inspectTravelportStaysReservationReceiptEvidence([
    genericConfirmation({ statusType: 'OfferStatusAir' }),
    genericCancellation({
      statusType: 'OfferStatusAir',
      sourceContext: 'Travelport',
      locatorType: 'Locator',
    }),
    travelportPnr(),
  ]);

  assert.equal(evidence.valid, true);
  assert.equal(evidence.travelportPnrReceipts[0]?.reference, '0GQ9HS');
  assert.deepEqual(evidence.supplierConfirmationReceipts, []);
  assert.deepEqual(evidence.supplierCancellationReceipts, []);
});
