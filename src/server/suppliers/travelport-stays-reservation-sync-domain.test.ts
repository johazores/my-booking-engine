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

function syncResponse(input: {
  supplierConfirmation?: string;
  propertyCode?: string;
  travelportLocatorType?: string | null;
} = {}) {
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
                ...(input.travelportLocatorType === null
                  ? {}
                  : { locatorType: input.travelportLocatorType ?? 'PNR Locator' }),
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

test('builds Booking.com Sync with complete bound traveler identity and contact authority', () => {
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
        PersonName: {
          Given: 'Mary',
          Surname: 'Smith',
        },
        Telephone: [{
          '@type': 'TelephoneDetail',
          countryAccessCode: '61',
          areaCityCode: '2',
          phoneNumber: '91234567',
        }],
        Email: [{ value: 'mary@example.com' }],
      }],
    },
  });
});

test('Sync carries the durable-bound traveler fields but excludes payment and credential material', () => {
  const serialized = JSON.stringify(buildTravelportStaysReservationSyncRequest({
    providerRecoveryReference: 'travelport-stays-sync-v1:BKNG:BO',
    supplierConfirmationReference: 'T9RY0-WQ842',
    traveler,
  }));
  for (const expected of ['Mary', 'Smith', '91234567', 'mary@example.com']) {
    assert.equal(serialized.includes(expected), true);
  }
  for (const forbidden of ['FormOfPayment', 'PaymentCard', 'CardNumber', 'SeriesCode', 'client_secret', 'password']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('Sync reuses the provider traveler limit and refuses provider-side name truncation', () => {
  assert.throws(() => buildTravelportStaysReservationSyncRequest({
    providerRecoveryReference: 'travelport-stays-sync-v1:BKNG:BO',
    supplierConfirmationReference: 'T9RY0-WQ842',
    traveler: {
      ...traveler,
      firstName: 'Alexanderthegreat',
      lastName: 'Longlastname',
    },
  }), /22 characters/);
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

test('accepts the documented Sync response omission of Travelport locatorType without mutating provider data', () => {
  const body = syncResponse({ travelportLocatorType: null });
  const travelportLocator = body.ReservationResponse.Reservation.Receipt[1]!.Confirmation.Locator as {
    locatorType?: string;
  };
  assert.equal(travelportLocator.locatorType, undefined);

  assert.deepEqual(classifyTravelportStaysReservationSyncOutcome({
    httpStatus: 200,
    body,
    expectedReservation,
    supplierConfirmationReference: 'T9RY0-WQ842',
  }), {
    status: 'CONFIRMED',
    providerReservationReference: '0GQ9HS',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
  });
  assert.equal(travelportLocator.locatorType, undefined);
});

test('does not reinterpret an explicit non-PNR Travelport locator type during Sync', () => {
  assert.deepEqual(classifyTravelportStaysReservationSyncOutcome({
    httpStatus: 200,
    body: syncResponse({ travelportLocatorType: 'Agency Locator' }),
    expectedReservation,
    supplierConfirmationReference: 'T9RY0-WQ842',
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    providerCorrelationId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
  });
});

test('keeps duplicate documented Travelport locator receipts ambiguous after Sync normalization', () => {
  const body = syncResponse({ travelportLocatorType: null });
  body.ReservationResponse.Reservation.Receipt.push(
    body.ReservationResponse.Reservation.Receipt[1]!,
  );

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
