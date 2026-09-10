import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { parseTravelportStaysReservationResponse } from './travelport-stays-reservation-response.ts';

const expectedReservation = Object.freeze({
  chainCode: 'XV',
  propertyCode: 'F5829',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 2,
});

function response() {
  return {
    ReservationResponse: {
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [
          {
            '@type': 'Offer',
            id: 'O1',
            passiveOfferInd: false,
            Product: [{
              '@type': 'ProductHospitality',
              Quantity: 1,
              guests: 2,
              PropertyKey: { chainCode: 'XV', propertyCode: 'F5829' },
              DateRange: { start: '2026-10-10', end: '2026-10-12' },
            }],
          },
          {
            '@type': 'Offer',
            id: 'O2',
            passiveOfferInd: true,
            Product: [{
              '@type': 'ProductHospitality',
              Quantity: 1,
              DateRange: { start: '2026-11-10', end: '2026-11-15' },
            }],
          },
        ],
        Receipt: [
          {
            '@type': 'ReceiptConfirmation',
            OfferRef: ['O1'],
            Confirmation: {
              '@type': 'ConfirmationHold',
              Locator: {
                value: '80073065',
                locatorType: 'Confirmation Number',
                source: 'XV',
                sourceContext: 'Supplier',
              },
              OfferStatus: { '@type': 'OfferStatusHospitality', code: 'HK', Status: 'Confirmed' },
            },
          },
          {
            '@type': 'ReceiptConfirmation',
            OfferRef: ['O2'],
            Confirmation: {
              '@type': 'ConfirmationHold',
              OfferStatus: { '@type': 'OfferStatusHospitality', code: 'AK', Status: 'Confirmed' },
            },
          },
          {
            '@type': 'ReceiptConfirmation',
            Confirmation: {
              '@type': 'ConfirmationHold',
              Locator: {
                value: 'D6VBHL',
                locatorType: 'PNR Locator',
                sourceContext: 'Travelport',
              },
              OfferStatus: { '@type': 'OfferStatusHospitality', Status: 'Confirmed' },
            },
          },
        ],
      },
      traceId: 'offer-type-test-trace',
    },
  };
}

function parse(value: unknown) {
  return parseTravelportStaysReservationResponse(value, {
    expectedProviderReservationReference: 'D6VBHL',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  });
}

test('known-locator recovery accepts canonical typed active and passive Travelport offers', () => {
  assert.deepEqual(parse(response()), {
    providerReservationReference: 'D6VBHL',
    supplierConfirmationReference: '80073065',
    providerCorrelationId: 'offer-type-test-trace',
  });
});

test('offer discriminator must be canonical before active or passive recovery scope is trusted', () => {
  for (const offerIndex of [0, 1]) {
    for (const malformedType of [undefined, null, '', 'OtherOffer', 'Offer\nsecret']) {
      const body = response();
      const offer = body.ReservationResponse.Reservation.Offer[offerIndex] as Record<string, unknown>;
      offer['@type'] = malformedType;

      assert.throws(
        () => parse(body),
        (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
        `offer ${offerIndex} with ${String(malformedType)} must fail closed`,
      );
    }
  }
});
