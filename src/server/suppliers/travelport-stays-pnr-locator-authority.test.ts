import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { classifyTravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';
import { parseTravelportStaysReservationResponse } from './travelport-stays-reservation-response.ts';

const expectedReservation = Object.freeze({
  chainCode: 'CN',
  propertyCode: 'B6381',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 2,
});

function reservationResponse(travelportReceipts: readonly Readonly<{
  value: string;
  locatorType: string;
}>[]) {
  return {
    ReservationResponse: {
      Reservation: {
        Offer: [{
          '@type': 'Offer',
          id: 'O1',
          passiveOfferInd: false,
          Identifier: { authority: 'BKNG' },
          Product: [{
            '@type': 'ProductHospitality',
            Quantity: 1,
            guests: 2,
            PropertyKey: { chainCode: 'CN', propertyCode: 'B6381' },
            DateRange: { start: '2026-10-10', end: '2026-10-12' },
          }],
        }],
        Receipt: [
          {
            OfferRef: ['O1'],
            Confirmation: {
              Locator: {
                value: 'T9RY0-WQ842',
                locatorType: 'Confirmation Number',
                source: 'BO',
                sourceContext: 'Supplier',
              },
              OfferStatus: { Status: 'Confirmed' },
            },
          },
          ...travelportReceipts.map(({ value, locatorType }) => ({
            Confirmation: {
              Locator: { value, locatorType, sourceContext: 'Travelport' },
              OfferStatus: { Status: 'Confirmed' },
            },
          })),
        ],
      },
      traceId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
    },
  };
}

test('known-locator response authority requires a canonical Travelport PNR Locator pair', () => {
  assert.throws(
    () => parseTravelportStaysReservationResponse(reservationResponse([
      { value: 'NOT-A-PNR', locatorType: 'Confirmation Number' },
    ])),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('known-locator response rejects contradictory Travelport locator-family evidence beside one valid PNR', () => {
  assert.throws(
    () => parseTravelportStaysReservationResponse(reservationResponse([
      { value: 'AUX-REFERENCE', locatorType: 'Confirmation Number' },
      { value: '0GQ9HS', locatorType: 'PNR Locator' },
    ]), {
      expectedProviderReservationReference: '0GQ9HS',
      expectedReservation,
      requireConfirmedTravelportReceipt: true,
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('Create cannot confirm a Travelport-context locator that is not a PNR Locator', () => {
  const result = classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: reservationResponse([{ value: 'NOT-A-PNR', locatorType: 'Confirmation Number' }]),
    expectedReservation,
  });

  assert.deepEqual(result, {
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    supplierConfirmationReference: null,
    providerCorrelationId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
  });
});

test('Create rejects contradictory Travelport locator-family evidence beside one valid PNR', () => {
  const result = classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: reservationResponse([
      { value: 'AUX-REFERENCE', locatorType: 'Confirmation Number' },
      { value: '0GQ9HS', locatorType: 'PNR Locator' },
    ]),
    expectedReservation,
  });

  assert.deepEqual(result, {
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    supplierConfirmationReference: null,
    providerCorrelationId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
  });
});
