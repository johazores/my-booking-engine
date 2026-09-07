import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTravelportStaysReservationSyncRequest,
  classifyTravelportStaysReservationSyncOutcome,
} from './travelport-stays-reservation-sync-domain.ts';

const expectedReservation = Object.freeze({
  chainCode: 'CN',
  propertyCode: 'B6381',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 2,
});

const traveler = Object.freeze({
  firstName: 'Mary',
  lastName: 'Smith',
  email: 'mary@example.com',
  telephone: Object.freeze({
    countryCallingCode: '61',
    areaCode: '2',
    subscriberNumber: '91234567',
  }),
});

function syncResponse(input: { supplierConfirmation?: string; propertyCode?: string } = {}) {
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
            PropertyKey: { chainCode: 'CN', propertyCode: input.propertyCode ?? 'B6381' },
            DateRange: { start: '2026-10-10', end: '2026-10-12' },
          }],
        }],
        Receipt: [
          {
            Confirmation: {
              Locator: {
                value: input.supplierConfirmation ?? 'T9RY0-WQ842',
                locatorType: 'Confirmation Number',
                source: 'BO',
                sourceContext: 'Supplier',
              },
              OfferStatus: { Status: 'Confirmed' },
            },
          },
          {
            Confirmation: {
              Locator: {
                value: '0GQ9HS',
                locatorType: 'PNR Locator',
                sourceContext: 'Travelport',
              },
              OfferStatus: { Status: 'Confirmed' },
            },
          },
        ],
      },
      traceId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
    },
  };
}

test('builds the minimal Booking.com Sync request from durable recovery authority', () => {
  assert.deepEqual(buildTravelportStaysReservationSyncRequest({
    providerRecoveryReference: 'travelport-stays-sync-v1:BKNG:BO',
    supplierConfirmationReference: 'T9RY0-WQ842',
    traveler,
  }), {
    ReservationDetail: {
      Offer: [{
        Identifier: { authority: 'BKNG' },
        passiveOfferInd: true,
      }],
      Receipt: [{
        '@type': 'ReceiptConfirmation',
        Confirmation: {
          '@type': 'ConfirmationHold',
          Locator: {
            locatorType: 'Confirmation Number',
            source: 'BO',
            sourceContext: 'Supplier',
            value: 'T9RY0-WQ842',
          },
        },
      }],
      Traveler: [{
        '@type': 'Traveler',
        Email: [{ value: 'mary@example.com' }],
      }],
    },
  });
});

test('Sync request excludes names, telephone and any payment or credential material', () => {
  const serialized = JSON.stringify(buildTravelportStaysReservationSyncRequest({
    providerRecoveryReference: 'travelport-stays-sync-v1:BKNG:BO',
    supplierConfirmationReference: 'T9RY0-WQ842',
    traveler,
  }));
  for (const forbidden of ['Mary', 'Smith', '91234567', 'FormOfPayment', 'PaymentCard', 'CardNumber', 'SeriesCode']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('rejects unproven provider recovery authority', () => {
  assert.throws(() => buildTravelportStaysReservationSyncRequest({
    providerRecoveryReference: 'travelport-stays-sync-v1:BKNG:XZ',
    supplierConfirmationReference: 'T9RY0-WQ842',
    traveler,
  }));
});

test('confirms Sync only when the exact stay and original supplier confirmation return with a Travelport locator', () => {
  assert.deepEqual(classifyTravelportStaysReservationSyncOutcome({
    httpStatus: 200,
    body: syncResponse(),
    expectedReservation,
    supplierConfirmationReference: 'T9RY0-WQ842',
  }), {
    status: 'CONFIRMED',
    providerReservationReference: '0GQ9HS',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
  });
});

test('keeps a mismatched supplier confirmation or reservation identity ambiguous', () => {
  for (const body of [
    syncResponse({ supplierConfirmation: 'OTHER-CONFIRMATION' }),
    syncResponse({ propertyCode: 'OTHER' }),
  ]) {
    assert.deepEqual(classifyTravelportStaysReservationSyncOutcome({
      httpStatus: 200,
      body,
      expectedReservation,
      supplierConfirmationReference: 'T9RY0-WQ842',
    }), {
      status: 'AMBIGUOUS',
      failureCode: 'INVALID_RESPONSE',
      providerCorrelationId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
    });
  }
});

test('keeps malformed or non-success Sync responses ambiguous', () => {
  assert.deepEqual(classifyTravelportStaysReservationSyncOutcome({
    httpStatus: 503,
    body: null,
    expectedReservation,
    supplierConfirmationReference: 'T9RY0-WQ842',
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    providerCorrelationId: null,
  });
});
