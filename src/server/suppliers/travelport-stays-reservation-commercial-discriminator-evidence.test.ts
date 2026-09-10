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

function response(input: Readonly<{
  reservationType?: unknown;
  omitReservationType?: boolean;
  offerType?: unknown;
  omitOfferType?: boolean;
  includeTravelport?: boolean;
  warning?: string;
}> = {}) {
  const reservation: Record<string, unknown> = {
    Offer: [{
      ...(input.omitOfferType ? {} : { '@type': input.offerType ?? 'Offer' }),
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
  };
  if (!input.omitReservationType) reservation['@type'] = input.reservationType ?? 'ReservationDetail';

  return {
    ReservationResponse: {
      Reservation: reservation,
      ...(input.warning ? { Result: { Warning: [{ Message: input.warning }] } } : {}),
      traceId: 'commercial-discriminator-evidence',
    },
  };
}

const invalidCreate = Object.freeze({
  status: 'AMBIGUOUS' as const,
  failureCode: 'INVALID_RESPONSE' as const,
  supplierConfirmationReference: null,
  providerCorrelationId: 'commercial-discriminator-evidence',
});

test('commercial Create accepts canonical ReservationDetail and Offer discriminators', () => {
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: response(),
    expectedReservation,
  }), {
    status: 'CONFIRMED',
    providerReservationReference: '0GQ9HS',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: 'commercial-discriminator-evidence',
  });
});

test('commercial Create rejects missing, malformed, or foreign Reservation discriminators', () => {
  for (const body of [
    response({ omitReservationType: true }),
    response({ reservationType: null }),
    response({ reservationType: '' }),
    response({ reservationType: 'Reservation' }),
    response({ reservationType: 'ReservationDetail\nforeign' }),
    response({ reservationType: 'x'.repeat(65) }),
    response({ reservationType: 42 }),
  ]) {
    assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
      httpStatus: 200,
      body,
      expectedReservation,
    }), invalidCreate);
  }
});

test('commercial Create rejects missing, malformed, or foreign Offer discriminators', () => {
  for (const body of [
    response({ omitOfferType: true }),
    response({ offerType: null }),
    response({ offerType: '' }),
    response({ offerType: 'OtherOffer' }),
    response({ offerType: 'Offer\nforeign' }),
    response({ offerType: 'x'.repeat(65) }),
    response({ offerType: false }),
  ]) {
    assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
      httpStatus: 200,
      body,
      expectedReservation,
    }), invalidCreate);
  }
});

test('supplier-confirmed no-PNR warning cannot mint Sync recovery authority from malformed discriminators', () => {
  const warning = 'Hotel sell confirmed from supplier. Travelport PNR processing did not complete. Use SYNC message with confirmation number to complete PNR.';
  for (const body of [
    response({ omitReservationType: true, includeTravelport: false, warning }),
    response({ reservationType: 'Reservation', includeTravelport: false, warning }),
    response({ omitOfferType: true, includeTravelport: false, warning }),
    response({ offerType: 'OtherOffer', includeTravelport: false, warning }),
  ]) {
    assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
      httpStatus: 200,
      body,
      expectedReservation,
    }), {
      status: 'AMBIGUOUS',
      failureCode: 'TRAVELPORT_SYNC_REQUIRED',
      supplierConfirmationReference: null,
      providerRecoveryReference: null,
      providerCorrelationId: 'commercial-discriminator-evidence',
    });
  }
});

test('Booking.com Sync response classification inherits the same discriminator boundary', () => {
  for (const body of [
    response({ omitReservationType: true }),
    response({ reservationType: 'Reservation' }),
    response({ omitOfferType: true }),
    response({ offerType: 'OtherOffer' }),
  ]) {
    assert.deepEqual(classifyTravelportStaysReservationSyncOutcome({
      httpStatus: 200,
      body,
      expectedReservation,
      supplierConfirmationReference: 'T9RY0-WQ842',
    }), {
      status: 'AMBIGUOUS',
      failureCode: 'INVALID_RESPONSE',
      providerCorrelationId: 'commercial-discriminator-evidence',
    });
  }
});