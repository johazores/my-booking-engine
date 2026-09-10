import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectTravelportStaysReservationReceiptEvidence } from './travelport-stays-reservation-receipt-evidence.ts';

type ReceiptOptions = Readonly<{
  sourceContext?: string;
  locatorType?: string;
  source?: string | null | 'absent';
  offerStatus?: Record<string, unknown> | null | 'absent';
}>;

function confirmationReceipt(options: ReceiptOptions = {}) {
  const locator: Record<string, unknown> = {
    value: 'D6VBHL',
    sourceContext: options.sourceContext ?? 'Travelport',
    locatorType: options.locatorType ?? 'PNR Locator',
  };
  if (options.source !== 'absent' && options.source !== undefined) {
    locator.source = options.source;
  }

  const confirmation: Record<string, unknown> = {
    '@type': 'ConfirmationHold',
    Locator: locator,
  };
  if (options.offerStatus !== 'absent') {
    confirmation.OfferStatus = options.offerStatus === undefined
      ? {
          '@type': 'OfferStatusHospitality',
          Status: 'Confirmed',
        }
      : options.offerStatus;
  }

  return {
    '@type': 'ReceiptConfirmation',
    Confirmation: confirmation,
  };
}

function cancellationReceipt(options: Pick<ReceiptOptions, 'source' | 'offerStatus'> = {}) {
  const locator: Record<string, unknown> = {
    value: 'CXL-123',
    locatorType: 'Cancellation Number',
    sourceContext: 'Supplier',
  };
  if (options.source !== 'absent' && options.source !== undefined) {
    locator.source = options.source;
  }

  const cancellation: Record<string, unknown> = {
    '@type': 'CancellationHold',
    Locator: locator,
  };
  if (options.offerStatus !== 'absent') {
    cancellation.OfferStatus = options.offerStatus === undefined
      ? {
          '@type': 'OfferStatusHospitality',
          Status: 'Cancelled',
        }
      : options.offerStatus;
  }

  return {
    '@type': 'ReceiptCancellation',
    Cancellation: cancellation,
  };
}

test('Stays receipt source omission remains compatible', () => {
  const evidence = inspectTravelportStaysReservationReceiptEvidence([
    confirmationReceipt({ source: 'absent' }),
  ]);

  assert.equal(evidence.valid, true);
  assert.equal(evidence.travelportPnrReceipts.length, 1);
  assert.equal(evidence.travelportPnrReceipts[0]?.source, null);
});

test('explicit null source is malformed for canonical Stays confirmation receipts', () => {
  for (const receipt of [
    confirmationReceipt({ source: null }),
    confirmationReceipt({
      sourceContext: 'Supplier',
      locatorType: 'Confirmation Number',
      source: null,
    }),
  ]) {
    assert.equal(inspectTravelportStaysReservationReceiptEvidence([receipt]).valid, false);
  }
});

test('Stays OfferStatus omission remains compatible but explicit null is malformed', () => {
  const omitted = inspectTravelportStaysReservationReceiptEvidence([
    confirmationReceipt({ offerStatus: 'absent' }),
  ]);
  assert.equal(omitted.valid, true);
  assert.equal(omitted.travelportPnrReceipts[0]?.status, null);

  const explicitNull = inspectTravelportStaysReservationReceiptEvidence([
    confirmationReceipt({ offerStatus: null }),
  ]);
  assert.equal(explicitNull.valid, false);
});

test('unrelated multi-content receipt can still carry null optional fields without Stays authority', () => {
  const evidence = inspectTravelportStaysReservationReceiptEvidence([
    confirmationReceipt({
      sourceContext: 'Order',
      locatorType: 'OrderId',
      source: null,
      offerStatus: null,
    }),
  ]);

  assert.equal(evidence.valid, true);
  assert.equal(evidence.travelportPnrReceipts.length, 0);
  assert.equal(evidence.supplierConfirmationReceipts.length, 0);
});

test('canonical Stays cancellation rejects explicit null source and OfferStatus', () => {
  assert.equal(
    inspectTravelportStaysReservationReceiptEvidence([
      cancellationReceipt({ source: null }),
    ]).valid,
    false,
  );
  assert.equal(
    inspectTravelportStaysReservationReceiptEvidence([
      cancellationReceipt({ offerStatus: null }),
    ]).valid,
    false,
  );
});

test('canonical Stays cancellation preserves genuine source and OfferStatus omission compatibility', () => {
  const evidence = inspectTravelportStaysReservationReceiptEvidence([
    cancellationReceipt({ source: 'absent', offerStatus: 'absent' }),
  ]);

  assert.equal(evidence.valid, true);
  assert.equal(evidence.supplierCancellationReceipts.length, 1);
  assert.equal(evidence.supplierCancellationReceipts[0]?.source, null);
  assert.equal(evidence.supplierCancellationReceipts[0]?.status, null);
});
