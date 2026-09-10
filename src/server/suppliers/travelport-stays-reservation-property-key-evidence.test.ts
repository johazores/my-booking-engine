import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { parseTravelportStaysReservationResponse } from './travelport-stays-reservation-response.ts';

const expectedReservation = Object.freeze({
  chainCode: 'XV',
  propertyCode: '89550',
  arrivalDateLocal: '2026-10-16',
  departureDateLocal: '2026-10-17',
  rooms: 1,
  guests: 1,
});

function response(propertyKeyType: unknown = 'PropertyKey') {
  return {
    ReservationResponse: {
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [{
          '@type': 'Offer',
          id: 'O1',
          passiveOfferInd: false,
          Product: [{
            '@type': 'ProductHospitality',
            Quantity: 1,
            guests: 1,
            PropertyKey: {
              '@type': propertyKeyType,
              chainCode: 'XV',
              propertyCode: '89550',
            },
            DateRange: {
              start: '2026-10-16',
              end: '2026-10-17',
            },
          }],
        }],
        Receipt: [
          {
            OfferRef: ['O1'],
            Confirmation: {
              Locator: {
                value: '80073065',
                locatorType: 'Confirmation Number',
                sourceContext: 'Supplier',
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
    },
  };
}

test('known-locator recovery accepts the canonical PropertyKey discriminator', () => {
  const recovered = parseTravelportStaysReservationResponse(response(), {
    expectedProviderReservationReference: 'D6VBHL',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  });

  assert.equal(recovered.providerReservationReference, 'D6VBHL');
  assert.equal(recovered.supplierConfirmationReference, '80073065');
});

test('known-locator recovery rejects explicit malformed or foreign PropertyKey discriminators', () => {
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
    assert.throws(
      () => parseTravelportStaysReservationResponse(response(propertyKeyType), {
        expectedProviderReservationReference: 'D6VBHL',
        expectedReservation,
        requireConfirmedTravelportReceipt: true,
      }),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
      `PropertyKey discriminator ${String(propertyKeyType)} must fail closed`,
    );
  }
});

test('known-locator recovery keeps omitted PropertyKey type compatible while still matching exact property identity', () => {
  const body = response();
  delete body.ReservationResponse.Reservation.Offer[0]!.Product[0]!.PropertyKey['@type'];

  const recovered = parseTravelportStaysReservationResponse(body, {
    expectedProviderReservationReference: 'D6VBHL',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  });

  assert.equal(recovered.providerReservationReference, 'D6VBHL');
});
