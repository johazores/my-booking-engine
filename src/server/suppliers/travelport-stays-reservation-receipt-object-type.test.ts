import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectTravelportStaysReservationReceiptEvidence } from './travelport-stays-reservation-receipt-evidence.ts';

function staysReceipt(input: Readonly<{
  confirmationType?: unknown;
  offerStatusType?: unknown;
  sourceContext?: string;
  locatorType?: string;
}>) {
  return {
    '@type': 'ReceiptConfirmation',
    Confirmation: {
      ...(input.confirmationType === undefined ? {} : { '@type': input.confirmationType }),
      Locator: {
        value: 'D6VBHL',
        sourceContext: input.sourceContext ?? 'Travelport',
        ...(input.locatorType === undefined ? { locatorType: 'PNR Locator' } : { locatorType: input.locatorType }),
      },
      OfferStatus: {
        ...(input.offerStatusType === undefined ? {} : { '@type': input.offerStatusType }),
        Status: 'Confirmed',
      },
    },
  };
}

test('accepts documented Stays confirmation object discriminators', () => {
  const result = inspectTravelportStaysReservationReceiptEvidence([
    staysReceipt({
      confirmationType: 'ConfirmationHold',
      offerStatusType: 'OfferStatusHospitality',
    }),
  ]);

  assert.equal(result.valid, true);
  assert.deepEqual(result.travelportPnrReceipts, [{
    reference: 'D6VBHL',
    status: 'Confirmed',
    source: null,
  }]);
});

test('fails closed when explicit confirmation or offer-status types contradict Stays locator authority', () => {
  for (const receipt of [
    staysReceipt({
      confirmationType: 'CancellationHold',
      offerStatusType: 'OfferStatusHospitality',
    }),
    staysReceipt({
      confirmationType: 'ConfirmationHold',
      offerStatusType: 'OfferStatusAir',
    }),
    staysReceipt({
      confirmationType: 'ConfirmationHold\nInjected',
      offerStatusType: 'OfferStatusHospitality',
    }),
    staysReceipt({
      confirmationType: 'ConfirmationHold',
      offerStatusType: 42,
    }),
  ]) {
    assert.equal(inspectTravelportStaysReservationReceiptEvidence([receipt]).valid, false);
  }
});

test('does not reinterpret unrelated multi-content confirmation types as Stays evidence', () => {
  const result = inspectTravelportStaysReservationReceiptEvidence([{
    '@type': 'ReceiptConfirmation',
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: 'AA001HD1YYTA7',
        sourceContext: 'OrderId',
        source: 'AA',
      },
      OfferStatus: {
        '@type': 'OfferStatusAir',
        StatusAir: [{ code: 'HK', value: 'Confirmed' }],
      },
    },
  }]);

  assert.equal(result.valid, true);
  assert.deepEqual(result.travelportPnrReceipts, []);
  assert.deepEqual(result.supplierConfirmationReceipts, []);
  assert.deepEqual(result.supplierCancellationReceipts, []);
});

test('continues to tolerate omitted inner type discriminators while rejecting explicit contradictions', () => {
  const result = inspectTravelportStaysReservationReceiptEvidence([staysReceipt({})]);
  assert.equal(result.valid, true);
  assert.equal(result.travelportPnrReceipts[0]?.reference, 'D6VBHL');
});
