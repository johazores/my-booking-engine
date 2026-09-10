import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectTravelportStaysReservationReceiptEvidence } from './travelport-stays-reservation-receipt-evidence.ts';

function supplierConfirmation() {
  return {
    '@type': 'ReceiptConfirmation',
    OfferRef: ['O1'],
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: '80073065',
        locatorType: 'Confirmation Number',
        sourceContext: 'Supplier',
        source: 'XV',
      },
      OfferStatus: {
        '@type': 'OfferStatusHospitality',
        Status: 'Confirmed',
      },
    },
  };
}

function supplierCancellation() {
  return {
    '@type': 'ReceiptCancellation',
    OfferRef: ['O1'],
    Cancellation: {
      '@type': 'CancellationHold',
      Locator: {
        value: '59824913',
        locatorType: 'Cancellation Number',
        sourceContext: 'Supplier',
        source: 'TX',
      },
      OfferStatus: {
        '@type': 'OfferStatusHospitality',
        Status: 'Cancelled',
      },
    },
  };
}

function invalid(receipt: unknown) {
  assert.equal(inspectTravelportStaysReservationReceiptEvidence([receipt]).valid, false);
}

test('keeps canonical ReceiptPayment outside Stays reservation authority', () => {
  const evidence = inspectTravelportStaysReservationReceiptEvidence([
    { '@type': 'ReceiptPayment', OfferRef: ['O1'], Document: [{ Number: '0019905292727' }] },
  ]);

  assert.equal(evidence.valid, true);
  assert.deepEqual(evidence.travelportPnrReceipts, []);
  assert.deepEqual(evidence.supplierConfirmationReceipts, []);
  assert.deepEqual(evidence.supplierCancellationReceipts, []);
});

test('rejects reservation branches hidden behind ReceiptPayment', () => {
  const confirmation = supplierConfirmation();
  invalid({
    '@type': 'ReceiptPayment',
    Document: [{ Number: '0019905292727' }],
    Confirmation: confirmation.Confirmation,
  });

  const cancellation = supplierCancellation();
  invalid({
    '@type': 'ReceiptPayment',
    Document: [{ Number: '0019905292727' }],
    Cancellation: cancellation.Cancellation,
  });
});

test('rejects mixed Confirmation and Cancellation branches regardless of outer receipt type', () => {
  const confirmation = supplierConfirmation();
  const cancellation = supplierCancellation();

  for (const receipt of [
    {
      ...confirmation,
      Cancellation: cancellation.Cancellation,
    },
    {
      ...cancellation,
      Confirmation: confirmation.Confirmation,
    },
    {
      OfferRef: ['O1'],
      Confirmation: confirmation.Confirmation,
      Cancellation: cancellation.Cancellation,
    },
  ]) {
    invalid(receipt);
  }
});

test('treats explicit-null conflicting reservation branches as present malformed evidence', () => {
  const confirmation = supplierConfirmation();
  invalid({ ...confirmation, Cancellation: null });

  const cancellation = supplierCancellation();
  invalid({ ...cancellation, Confirmation: null });

  invalid({ '@type': 'ReceiptPayment', Confirmation: null, Payment: { '@type': 'Payment' } });
});
