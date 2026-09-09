import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectTravelportStaysReservationReceiptEvidence } from './travelport-stays-reservation-receipt-evidence.ts';

function confirmation(input: Readonly<{
  value: unknown;
  locatorType: unknown;
  sourceContext: unknown;
  source?: unknown;
  status?: unknown;
}>) {
  return {
    '@type': 'ReceiptConfirmation',
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: input.value,
        locatorType: input.locatorType,
        sourceContext: input.sourceContext,
        ...(input.source === undefined ? {} : { source: input.source }),
      },
      OfferStatus: {
        '@type': 'OfferStatusHospitality',
        Status: input.status ?? 'Confirmed',
      },
    },
  };
}

test('accepts documented Booking.com supplier PIN evidence without promoting it to durable identity', () => {
  const result = inspectTravelportStaysReservationReceiptEvidence([
    confirmation({
      value: 'T9RY0-WQ842',
      locatorType: 'Confirmation Number',
      sourceContext: 'Supplier',
      source: 'BO',
    }),
    confirmation({
      value: '4619',
      locatorType: 'Pin code',
      sourceContext: 'Supplier',
      source: 'BO',
    }),
    confirmation({
      value: '0GQ9HS',
      locatorType: 'PNR Locator',
      sourceContext: 'Travelport',
    }),
  ]);

  assert.equal(result.valid, true);
  assert.deepEqual(result.travelportPnrReceipts.map((receipt) => receipt.reference), ['0GQ9HS']);
  assert.deepEqual(result.supplierConfirmationReceipts.map((receipt) => receipt.reference), ['T9RY0-WQ842']);
  assert.deepEqual(result.supplierCancellationReceipts, []);
});

test('keeps PIN evidence structurally fail-closed and Supplier-context bound', () => {
  for (const receipt of [
    confirmation({
      value: '4619',
      locatorType: 'Pin code',
      sourceContext: 'Other',
      source: 'BO',
    }),
    confirmation({
      value: 'BAD\nPIN',
      locatorType: 'Pin code',
      sourceContext: 'Supplier',
      source: 'BO',
    }),
    confirmation({
      value: '4619',
      locatorType: 'Pin code',
      sourceContext: 'Supplier',
      source: 'BO',
      status: 'Confirmed\nInjected',
    }),
  ]) {
    assert.equal(inspectTravelportStaysReservationReceiptEvidence([receipt]).valid, false);
  }
});
