import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectTravelportStaysReservationReceiptEvidence } from './travelport-stays-reservation-receipt-evidence.ts';

function confirmation(input: Readonly<{
  value: string;
  locatorType?: string;
  sourceContext?: string;
  source?: string;
  status?: string;
  receiptType?: string;
}>) {
  return {
    ...(input.receiptType === undefined ? {} : { '@type': input.receiptType }),
    Confirmation: {
      Locator: {
        value: input.value,
        ...(input.locatorType === undefined ? {} : { locatorType: input.locatorType }),
        ...(input.sourceContext === undefined ? {} : { sourceContext: input.sourceContext }),
        ...(input.source === undefined ? {} : { source: input.source }),
      },
      ...(input.status === undefined ? {} : { OfferStatus: { Status: input.status } }),
    },
  };
}

test('normalizes Stays locator families while ignoring bounded unrelated multi-content receipts', () => {
  const result = inspectTravelportStaysReservationReceiptEvidence([
    confirmation({
      receiptType: 'ReceiptConfirmation',
      value: '80073065',
      locatorType: 'Confirmation Number',
      sourceContext: 'Supplier',
      source: 'XV',
      status: 'Confirmed',
    }),
    confirmation({
      receiptType: 'ReceiptConfirmation',
      value: '96120603',
      locatorType: 'IATA Number',
      sourceContext: 'Agency',
      status: 'Confirmed',
    }),
    confirmation({
      receiptType: 'ReceiptConfirmation',
      value: 'D6VBHL',
      locatorType: 'PNR Locator',
      sourceContext: 'Travelport',
      status: 'Confirmed',
    }),
    { '@type': 'ReceiptPayment', Document: [{ Number: 'not-reservation-authority' }] },
    confirmation({
      receiptType: 'ReceiptConfirmation',
      value: 'AA001HD1YYTA7',
      sourceContext: 'OrderId',
      source: 'AA',
    }),
  ]);

  assert.equal(result.valid, true);
  assert.deepEqual(result.travelportPnrReceipts, [{ reference: 'D6VBHL', status: 'Confirmed', source: null }]);
  assert.deepEqual(result.supplierConfirmationReceipts, [{ reference: '80073065', status: 'Confirmed', source: 'XV' }]);
  assert.deepEqual(result.supplierCancellationReceipts, []);
});

test('captures supplier cancellation evidence separately from confirmation evidence', () => {
  const result = inspectTravelportStaysReservationReceiptEvidence([
    confirmation({
      receiptType: 'ReceiptConfirmation',
      value: '59824913',
      locatorType: 'Cancellation Number',
      sourceContext: 'Supplier',
      source: 'TX',
      status: 'Cancelled',
    }),
    confirmation({
      receiptType: 'ReceiptConfirmation',
      value: 'D6YPS5',
      locatorType: 'PNR Locator',
      sourceContext: 'Travelport',
      status: 'Confirmed',
    }),
  ]);

  assert.equal(result.valid, true);
  assert.deepEqual(result.supplierConfirmationReceipts, []);
  assert.deepEqual(result.supplierCancellationReceipts, [{ reference: '59824913', status: 'Cancelled', source: 'TX' }]);
});

test('fails closed on malformed or partial Stays receipt structure', () => {
  for (const receipts of [
    [null],
    [{ '@type': 'UnknownReceipt' }],
    [{ '@type': 'ReceiptConfirmation' }],
    [{ '@type': 'ReceiptConfirmation', Confirmation: {} }],
    [confirmation({ receiptType: 'ReceiptConfirmation', value: 'D6VBHL', sourceContext: 'Travelport' })],
    [confirmation({ receiptType: 'ReceiptConfirmation', value: 'D6VBHL', locatorType: 'PNR Locator' })],
    [confirmation({ receiptType: 'ReceiptConfirmation', value: 'BAD\nPNR', locatorType: 'PNR Locator', sourceContext: 'Travelport' })],
    [confirmation({ receiptType: 'ReceiptConfirmation', value: 'D6VBHL', locatorType: 'PNR Locator', sourceContext: 'Travelport', status: 'Bad\nStatus' })],
    [confirmation({ receiptType: 'ReceiptConfirmation', value: '80073065', locatorType: 'Confirmation Number', sourceContext: 'Supplier', source: 'TOO-LONG-SUPPLIER-SOURCE' })],
  ]) {
    assert.equal(inspectTravelportStaysReservationReceiptEvidence(receipts).valid, false);
  }
});

test('documented Sync-only Travelport locator omission remains invalid until the Sync normalizer adds locatorType', () => {
  const result = inspectTravelportStaysReservationReceiptEvidence([
    confirmation({
      receiptType: 'ReceiptConfirmation',
      value: '0GQ9HS',
      sourceContext: 'Travelport',
      status: 'Confirmed',
    }),
  ]);
  assert.equal(result.valid, false);
});
