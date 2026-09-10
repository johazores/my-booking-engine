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

test('accepts canonical Travelport Stays hospitality status evidence', () => {
  const evidence = inspectTravelportStaysReservationReceiptEvidence([travelportPnr()]);

  assert.equal(evidence.valid, true);
  assert.equal(evidence.travelportPnrReceipts[0]?.reference, '0GQ9HS');
});

test('does not let hospitality status evidence disappear when Stays locator identity is omitted', () => {
  for (const statusType of ['OfferStatusHospitality', ' OfferStatusHospitality', 'OfferStatusHospitality ']) {
    const evidence = inspectTravelportStaysReservationReceiptEvidence([
      genericConfirmation({ statusType }),
      travelportPnr(),
    ]);

    assert.equal(evidence.valid, false);
  }
});

test('rejects hospitality status evidence paired with a non-Stays locator family', () => {
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

test('preserves unrelated air confirmation status evidence in multi-content reservations', () => {
  const evidence = inspectTravelportStaysReservationReceiptEvidence([
    genericConfirmation({ statusType: 'OfferStatusAir' }),
    travelportPnr(),
  ]);

  assert.equal(evidence.valid, true);
  assert.equal(evidence.travelportPnrReceipts[0]?.reference, '0GQ9HS');
  assert.deepEqual(evidence.supplierConfirmationReceipts, []);
  assert.deepEqual(evidence.supplierCancellationReceipts, []);
});
