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

const exactHospitalityProduct = () => ({
  '@type': 'ProductHospitality',
  Quantity: 1,
  guests: 2,
  PropertyKey: { chainCode: 'CN', propertyCode: 'B6381' },
  DateRange: { start: '2026-10-10', end: '2026-10-12' },
});

const mismatchedHospitalityProduct = () => ({
  '@type': 'ProductHospitality',
  Quantity: 1,
  guests: 2,
  PropertyKey: { chainCode: 'CN', propertyCode: 'OTHER' },
  DateRange: { start: '2026-10-10', end: '2026-10-12' },
});

const malformedHospitalityProduct = () => ({
  '@type': 'ProductHospitality',
  Quantity: 1,
  guests: 2,
});

function reservationResponse(products: unknown[], input: { includeTravelport?: boolean; warning?: string } = {}) {
  return {
    ReservationResponse: {
      Reservation: {
        Offer: [{
          '@type': 'Offer',
          Identifier: { authority: 'BKNG' },
          Product: products,
        }],
        Receipt: [
          {
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
          ...(input.includeTravelport === false ? [] : [{
            Confirmation: {
              Locator: { value: '0GQ9HS', locatorType: 'PNR Locator', sourceContext: 'Travelport' },
              OfferStatus: { Status: 'Confirmed' },
            },
          }]),
        ],
      },
      ...(input.warning ? { Result: { Warning: [{ Message: input.warning }] } } : {}),
      traceId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
    },
  };
}

function assertInvalidCreate(products: unknown[]) {
  const result = classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: reservationResponse(products),
    expectedReservation,
  });
  assert.deepEqual(result, {
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    supplierConfirmationReference: null,
    providerCorrelationId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
  });
}

function assertInvalidRetrieve(products: unknown[]) {
  assert.throws(
    () => parseTravelportStaysReservationResponse(reservationResponse(products), {
      expectedProviderReservationReference: '0GQ9HS',
      expectedReservation,
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
}

test('Create fails closed when one matching hotel segment is accompanied by another hospitality segment', () => {
  assertInvalidCreate([exactHospitalityProduct(), mismatchedHospitalityProduct()]);
  assertInvalidCreate([exactHospitalityProduct(), malformedHospitalityProduct()]);
});

test('known-locator Retrieve fails closed on additional or malformed hospitality segments', () => {
  assertInvalidRetrieve([exactHospitalityProduct(), mismatchedHospitalityProduct()]);
  assertInvalidRetrieve([exactHospitalityProduct(), malformedHospitalityProduct()]);
});

test('Booking.com Sync recovery authority is withheld when additional hospitality segment evidence exists', () => {
  const warning = 'Hotel sell confirmed from supplier. Travelport PNR processing did not complete. Use SYNC message with confirmation number to complete PNR.';
  const result = classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: reservationResponse([exactHospitalityProduct(), mismatchedHospitalityProduct()], {
      includeTravelport: false,
      warning,
    }),
    expectedReservation,
  });
  assert.equal(result.status, 'AMBIGUOUS');
  if (result.status === 'AMBIGUOUS') {
    assert.equal(result.failureCode, 'TRAVELPORT_SYNC_REQUIRED');
    assert.equal(result.supplierConfirmationReference, null);
    assert.equal(result.providerRecoveryReference, null);
  }
});

test('non-hospitality products do not create false ambiguity in a multi-content Travelport reservation', () => {
  const products = [
    exactHospitalityProduct(),
    { '@type': 'ProductAir', id: 'product_air_1' },
  ];
  const create = classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: reservationResponse(products),
    expectedReservation,
  });
  assert.equal(create.status, 'CONFIRMED');

  const retrieve = parseTravelportStaysReservationResponse(reservationResponse(products), {
    expectedProviderReservationReference: '0GQ9HS',
    expectedReservation,
  });
  assert.equal(retrieve.providerReservationReference, '0GQ9HS');
});
