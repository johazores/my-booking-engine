import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyTravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';
import { classifyTravelportStaysReservationSyncOutcome } from './travelport-stays-reservation-sync-domain.ts';

const expectedReservation = Object.freeze({
  chainCode: 'CN',
  propertyCode: 'B6381',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 2,
});

const confirmedWithoutPnrWarning =
  'Hotel sell confirmed from supplier. Travelport PNR processing did not complete. Use SYNC message with confirmation number to complete PNR.';

function response(input: Readonly<{
  supplierOfferRef?: unknown;
  omitSupplierOfferRef?: boolean;
  travelportOfferRef?: unknown;
  omitHotelOfferId?: boolean;
  includeSecondOffer?: boolean;
  secondOfferId?: string;
  includeTravelport?: boolean;
  warning?: string;
}> = {}) {
  const supplierReceipt: Record<string, unknown> = {
    '@type': 'ReceiptConfirmation',
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: 'T9RY0-WQ842',
        locatorType: 'Confirmation Number',
        source: 'BO',
        sourceContext: 'Supplier',
      },
      OfferStatus: { '@type': 'OfferStatusHospitality', Status: 'Confirmed' },
    },
  };
  if (!input.omitSupplierOfferRef) {
    supplierReceipt.OfferRef = input.supplierOfferRef === undefined ? ['O1'] : input.supplierOfferRef;
  }

  const travelportReceipt: Record<string, unknown> = {
    '@type': 'ReceiptConfirmation',
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: '0GQ9HS',
        locatorType: 'PNR Locator',
        sourceContext: 'Travelport',
      },
      OfferStatus: { '@type': 'OfferStatusHospitality', Status: 'Confirmed' },
    },
  };
  if (input.travelportOfferRef !== undefined) travelportReceipt.OfferRef = input.travelportOfferRef;

  const offers: Record<string, unknown>[] = [{
    '@type': 'Offer',
    ...(input.omitHotelOfferId ? {} : { id: 'O1' }),
    Identifier: { authority: 'BKNG' },
    Product: [{
      '@type': 'ProductHospitality',
      Quantity: 1,
      guests: 2,
      PropertyKey: { '@type': 'PropertyKey', chainCode: 'CN', propertyCode: 'B6381' },
      DateRange: { start: '2026-10-10', end: '2026-10-12' },
    }],
  }];
  if (input.includeSecondOffer !== false) {
    offers.push({
      '@type': 'Offer',
      id: input.secondOfferId ?? 'O2',
      Identifier: { authority: 'Travelport' },
      Product: [{ '@type': 'ProductAir', id: 'product-air-1' }],
    });
  }

  return {
    ReservationResponse: {
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: offers,
        Receipt: [
          supplierReceipt,
          ...(input.includeTravelport === false ? [] : [travelportReceipt]),
        ],
      },
      ...(input.warning ? { Result: { Warning: [{ Message: input.warning }] } } : {}),
      traceId: 'commercial-receipt-scope',
    },
  };
}

const invalidCreate = Object.freeze({
  status: 'AMBIGUOUS' as const,
  failureCode: 'INVALID_RESPONSE' as const,
  supplierConfirmationReference: null,
  providerCorrelationId: 'commercial-receipt-scope',
});

test('commercial Create accepts supplier confirmation scoped to the matching hotel offer and reservation-level PNR', () => {
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: response(),
    expectedReservation,
  }), {
    status: 'CONFIRMED',
    providerReservationReference: '0GQ9HS',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: 'commercial-receipt-scope',
  });
});

test('commercial Create rejects supplier confirmation scoped outside the matching hotel offer', () => {
  for (const supplierOfferRef of [
    ['O2'],
    [],
    ['O1', 'O2'],
    ['O1', 'O1'],
    'O1',
    [null],
    ['O1\nO2'],
  ]) {
    assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
      httpStatus: 200,
      body: response({ supplierOfferRef }),
      expectedReservation,
    }), invalidCreate);
  }
});

test('multi-offer commercial responses cannot use unscoped supplier confirmation as hotel authority', () => {
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: response({ omitSupplierOfferRef: true }),
    expectedReservation,
  }), invalidCreate);
});

test('scoped supplier confirmation requires a bounded matching hotel offer id', () => {
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: response({ omitHotelOfferId: true }),
    expectedReservation,
  }), invalidCreate);

  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: response({ secondOfferId: 'O1' }),
    expectedReservation,
  }), invalidCreate);
});

test('Travelport PNR remains reservation-level and cannot carry OfferRef', () => {
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: response({ travelportOfferRef: ['O1'] }),
    expectedReservation,
  }), invalidCreate);
});

test('single-offer legacy response remains unambiguous when supplier confirmation has no OfferRef', () => {
  assert.equal(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: response({ omitSupplierOfferRef: true, includeSecondOffer: false, omitHotelOfferId: true }),
    expectedReservation,
  }).status, 'CONFIRMED');
});

test('supplier-confirmed no-PNR warning mints Sync recovery authority only from correctly scoped supplier evidence', () => {
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: response({ includeTravelport: false, warning: confirmedWithoutPnrWarning }),
    expectedReservation,
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SYNC_REQUIRED',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerRecoveryReference: 'travelport-stays-sync-v1:BKNG:BO',
    providerCorrelationId: 'commercial-receipt-scope',
  });

  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: response({
      supplierOfferRef: ['O2'],
      includeTravelport: false,
      warning: confirmedWithoutPnrWarning,
    }),
    expectedReservation,
  }), invalidCreate);
});

test('Booking.com Sync inherits the commercial receipt ownership boundary', () => {
  assert.deepEqual(classifyTravelportStaysReservationSyncOutcome({
    httpStatus: 200,
    body: response({ supplierOfferRef: ['O2'] }),
    expectedReservation,
    supplierConfirmationReference: 'T9RY0-WQ842',
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    providerCorrelationId: 'commercial-receipt-scope',
  });
});
