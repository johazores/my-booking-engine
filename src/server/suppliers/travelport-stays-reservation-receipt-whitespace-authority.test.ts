import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectTravelportStaysReservationReceiptEvidence } from './travelport-stays-reservation-receipt-evidence.ts';

type ConfirmationReceipt = {
  '@type': string;
  OfferRef?: string[];
  Confirmation: {
    '@type': string;
    Locator: {
      value: string;
      locatorType: string;
      sourceContext: string;
      source?: string;
    };
    OfferStatus: {
      '@type': string;
      Status: string;
    };
  };
};

type CancellationReceipt = {
  '@type': 'ReceiptCancellation';
  OfferRef: string[];
  Cancellation: {
    '@type': string;
    Locator: {
      value: string;
      locatorType: string;
      sourceContext: string;
      source: string;
    };
    OfferStatus: {
      '@type': string;
      Status: string;
    };
  };
};

function supplierConfirmation(): ConfirmationReceipt {
  return {
    '@type': 'ReceiptConfirmation',
    OfferRef: ['O1'],
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: 'T9RY0-WQ842',
        locatorType: 'Confirmation Number',
        sourceContext: 'Supplier',
        source: 'BO',
      },
      OfferStatus: {
        '@type': 'OfferStatusHospitality',
        Status: 'Confirmed',
      },
    },
  };
}

function travelportPnr(): ConfirmationReceipt {
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

function supplierCancellation(): CancellationReceipt {
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

function expectInvalid(receipt: unknown) {
  assert.equal(inspectTravelportStaysReservationReceiptEvidence([receipt]).valid, false);
}

test('accepts canonical unpadded Stays confirmation authority', () => {
  const evidence = inspectTravelportStaysReservationReceiptEvidence([
    supplierConfirmation(),
    travelportPnr(),
  ]);

  assert.equal(evidence.valid, true);
  assert.equal(evidence.supplierConfirmationReceipts[0]?.reference, 'T9RY0-WQ842');
  assert.equal(evidence.travelportPnrReceipts[0]?.reference, '0GQ9HS');
});

test('rejects outer whitespace on Stays confirmation authority tokens', () => {
  const variants: ConfirmationReceipt[] = [];

  const receiptType = supplierConfirmation();
  receiptType['@type'] = ' ReceiptConfirmation';
  variants.push(receiptType);

  const confirmationType = supplierConfirmation();
  confirmationType.Confirmation['@type'] = 'ConfirmationHold ';
  variants.push(confirmationType);

  const locatorValue = supplierConfirmation();
  locatorValue.Confirmation.Locator.value = ' T9RY0-WQ842';
  variants.push(locatorValue);

  const locatorType = supplierConfirmation();
  locatorType.Confirmation.Locator.locatorType = 'Confirmation Number ';
  variants.push(locatorType);

  const sourceContext = supplierConfirmation();
  sourceContext.Confirmation.Locator.sourceContext = ' Supplier';
  variants.push(sourceContext);

  const source = supplierConfirmation();
  source.Confirmation.Locator.source = 'BO ';
  variants.push(source);

  const offerStatusType = supplierConfirmation();
  offerStatusType.Confirmation.OfferStatus['@type'] = ' OfferStatusHospitality';
  variants.push(offerStatusType);

  const status = supplierConfirmation();
  status.Confirmation.OfferStatus.Status = 'Confirmed ';
  variants.push(status);

  for (const variant of variants) expectInvalid(variant);
});

test('rejects embedded ASCII control characters in Stays receipt authority tokens', () => {
  for (const control of ['\t', '\u0000', '\u001f', '\u007f']) {
    const locatorValue = supplierConfirmation();
    locatorValue.Confirmation.Locator.value = `T9RY0${control}WQ842`;
    expectInvalid(locatorValue);

    const source = supplierConfirmation();
    source.Confirmation.Locator.source = `B${control}O`;
    expectInvalid(source);

    const offerRef = supplierConfirmation();
    offerRef.OfferRef = [`O${control}1`];
    expectInvalid(offerRef);

    const cancellationValue = supplierCancellation();
    cancellationValue.Cancellation.Locator.value = `5982${control}4913`;
    expectInvalid(cancellationValue);

    const cancellationSource = supplierCancellation();
    cancellationSource.Cancellation.Locator.source = `T${control}X`;
    expectInvalid(cancellationSource);

    const cancellationOfferRef = supplierCancellation();
    cancellationOfferRef.OfferRef = [`O${control}1`];
    expectInvalid(cancellationOfferRef);
  }
});

test('rejects padded, duplicate, null, and malformed offer-scope references on Stays receipts', () => {
  const padded = supplierConfirmation();
  padded.OfferRef = [' O1'];
  expectInvalid(padded);

  const duplicate = supplierConfirmation();
  duplicate.OfferRef = ['O1', 'O1'];
  expectInvalid(duplicate);

  const explicitNull = supplierConfirmation();
  (explicitNull as unknown as { OfferRef: unknown }).OfferRef = null;
  expectInvalid(explicitNull);

  const malformed = supplierConfirmation();
  (malformed as unknown as { OfferRef: unknown }).OfferRef = ['O1', 1];
  expectInvalid(malformed);
});

test('applies the same unpadded token rule to relevant Stays cancellation evidence', () => {
  const canonical = inspectTravelportStaysReservationReceiptEvidence([supplierCancellation()]);
  assert.equal(canonical.valid, true);
  assert.equal(canonical.supplierCancellationReceipts[0]?.reference, '59824913');

  const paddedOfferRef = supplierCancellation();
  paddedOfferRef.OfferRef = ['O1 '];
  expectInvalid(paddedOfferRef);

  const paddedSourceContext = supplierCancellation();
  paddedSourceContext.Cancellation.Locator.sourceContext = 'Supplier ';
  expectInvalid(paddedSourceContext);

  const paddedLocator = supplierCancellation();
  paddedLocator.Cancellation.Locator.value = ' 59824913';
  expectInvalid(paddedLocator);

  const paddedStatus = supplierCancellation();
  paddedStatus.Cancellation.OfferStatus.Status = 'Cancelled ';
  expectInvalid(paddedStatus);
});

test('keeps canonical unrelated payment receipts outside Stays locator authority', () => {
  const evidence = inspectTravelportStaysReservationReceiptEvidence([
    { '@type': 'ReceiptPayment', Payment: { amount: 100 } },
    supplierConfirmation(),
    travelportPnr(),
  ]);

  assert.equal(evidence.valid, true);
  assert.equal(evidence.supplierConfirmationReceipts.length, 1);
  assert.equal(evidence.travelportPnrReceipts.length, 1);
});
