import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyTravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';

const expectedReservation = Object.freeze({
  chainCode: 'CN',
  propertyCode: 'B6381',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 1,
});

const confirmedWithoutPnrWarning =
  'Hotel sell confirmed from supplier. Travelport PNR processing did not complete. Use SYNC message with confirmation number to complete PNR.';

function response(input: Readonly<{
  propertyKeyType?: unknown;
  omitPropertyKeyType?: boolean;
  includeTravelport?: boolean;
  warning?: string;
}> = {}) {
  const propertyKey: Record<string, unknown> = {
    chainCode: 'CN',
    propertyCode: 'B6381',
  };
  if (!input.omitPropertyKeyType) propertyKey['@type'] = input.propertyKeyType ?? 'PropertyKey';

  return {
    ReservationResponse: {
      Reservation: {
        Offer: [{
          '@type': 'Offer',
          Identifier: { authority: 'BKNG' },
          Product: [{
            '@type': 'ProductHospitality',
            Quantity: 1,
            guests: 1,
            PropertyKey: propertyKey,
            DateRange: { start: '2026-10-10', end: '2026-10-12' },
          }],
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
              Locator: {
                value: '0GQ9HS',
                locatorType: 'PNR Locator',
                sourceContext: 'Travelport',
              },
              OfferStatus: { Status: 'Confirmed' },
            },
          }]),
        ],
      },
      ...(input.warning ? { Result: { Warning: [{ Message: input.warning }] } } : {}),
      traceId: 'property-key-commercial-evidence',
    },
  };
}

test('commercial response identity accepts canonical or omitted PropertyKey type evidence', () => {
  for (const body of [response(), response({ omitPropertyKeyType: true })]) {
    assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
      httpStatus: 200,
      body,
      expectedReservation,
    }), {
      status: 'CONFIRMED',
      providerReservationReference: '0GQ9HS',
      supplierConfirmationReference: 'T9RY0-WQ842',
      providerCorrelationId: 'property-key-commercial-evidence',
    });
  }
});

test('commercial response identity rejects explicit malformed or foreign PropertyKey type evidence', () => {
  for (const propertyKeyType of [
    '',
    'Property',
    'PropertyDetail',
    'PropertyKey\nforeign',
    'x'.repeat(65),
    42,
    false,
    [],
    {},
  ]) {
    assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
      httpStatus: 200,
      body: response({ propertyKeyType }),
      expectedReservation,
    }), {
      status: 'AMBIGUOUS',
      failureCode: 'INVALID_RESPONSE',
      supplierConfirmationReference: null,
      providerCorrelationId: 'property-key-commercial-evidence',
    });
  }
});

test('supplier-confirmed no-PNR evidence cannot mint Sync recovery authority from a contradictory PropertyKey type', () => {
  const result = classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: response({
      propertyKeyType: 'PropertyDetail',
      includeTravelport: false,
      warning: confirmedWithoutPnrWarning,
    }),
    expectedReservation,
  });

  assert.deepEqual(result, {
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SYNC_REQUIRED',
    supplierConfirmationReference: null,
    providerRecoveryReference: null,
    providerCorrelationId: 'property-key-commercial-evidence',
  });
});
