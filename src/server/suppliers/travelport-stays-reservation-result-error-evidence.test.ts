import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { classifyTravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';
import { parseTravelportStaysReservationResponse } from './travelport-stays-reservation-response.ts';

const expectedReservation = Object.freeze({
  chainCode: 'HI',
  propertyCode: 'ABC12',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 2,
});

function reservationResponse(result?: unknown) {
  return {
    ReservationResponse: {
      Reservation: {
        Offer: [{
          '@type': 'Offer',
          Identifier: { authority: 'BKNG' },
          Product: [{
            '@type': 'ProductHospitality',
            Quantity: 1,
            guests: 2,
            PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' },
            DateRange: { start: '2026-10-10', end: '2026-10-12' },
          }],
        }],
        Receipt: [
          {
            Confirmation: {
              Locator: {
                value: '80073065',
                locatorType: 'Confirmation Number',
                sourceContext: 'Supplier',
                source: 'BO',
              },
              OfferStatus: { Status: 'Confirmed' },
            },
          },
          {
            Confirmation: {
              Locator: {
                value: 'D6VBHL',
                locatorType: 'PNR Locator',
                sourceContext: 'Travelport',
              },
              OfferStatus: { Status: 'Confirmed' },
            },
          },
        ],
      },
      ...(result === undefined ? {} : { Result: result }),
      traceId: '5ba67b95-a9b2-4d0b-b3a2-b075969e79f1',
    },
  };
}

const embeddedError = Object.freeze({
  StatusCode: 200,
  SourceCode: '13020',
  Message: 'provider error text must never grant success authority',
});

test('Create fails closed when a success envelope also contains Result error evidence', () => {
  for (const result of [
    { Error: [embeddedError] },
    { Errors: [embeddedError] },
    { Error: [], Warning: [{ Message: 'also warned' }] },
  ]) {
    assert.deepEqual(
      classifyTravelportStaysReservationCreateOutcome({
        httpStatus: 200,
        body: reservationResponse(result),
        expectedReservation,
      }),
      {
        status: 'AMBIGUOUS',
        failureCode: 'INVALID_RESPONSE',
        supplierConfirmationReference: null,
        providerCorrelationId: '5ba67b95-a9b2-4d0b-b3a2-b075969e79f1',
      },
    );
  }
});

test('known-locator Retrieve fails closed on embedded Result error evidence', () => {
  for (const result of [
    { Error: [embeddedError] },
    { Errors: [embeddedError] },
    { Error: [] },
  ]) {
    assert.throws(
      () => parseTravelportStaysReservationResponse(reservationResponse(result), {
        expectedProviderReservationReference: 'D6VBHL',
        expectedReservation,
      }),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('Create and known-locator Retrieve reject malformed Result warning evidence consistently', () => {
  const malformedResults = [
    { Warning: { Message: 'warning container must be an array' } },
    { Warnings: 'warning container must be an array' },
    { Warning: [{ Message: '' }] },
    { Warning: [{ Message: 'unsafe\nwarning' }] },
    { Warning: [{ Message: 'one warning family' }], Warnings: [{ Message: 'conflicting warning family' }] },
    { Warning: Array.from({ length: 33 }, () => ({ Message: 'bounded warning' })) },
  ];

  for (const result of malformedResults) {
    assert.equal(
      classifyTravelportStaysReservationCreateOutcome({
        httpStatus: 200,
        body: reservationResponse(result),
        expectedReservation,
      }).status,
      'AMBIGUOUS',
    );

    assert.throws(
      () => parseTravelportStaysReservationResponse(reservationResponse(result), {
        expectedProviderReservationReference: 'D6VBHL',
        expectedReservation,
      }),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('warning-only ReservationResponse Result remains usable when all durable evidence agrees', () => {
  for (const result of [
    { Warning: [{ Message: 'Non-commercial provider warning.' }] },
    { Warnings: [{ Message: 'Defensive plural warning shape.' }] },
  ]) {
    const body = reservationResponse(result);

    assert.equal(classifyTravelportStaysReservationCreateOutcome({
      httpStatus: 200,
      body,
      expectedReservation,
    }).status, 'CONFIRMED');

    assert.equal(parseTravelportStaysReservationResponse(body, {
      expectedProviderReservationReference: 'D6VBHL',
      expectedReservation,
    }).providerReservationReference, 'D6VBHL');
  }
});
