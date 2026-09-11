import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  parseTravelportStaysReservationResponse,
  type TravelportStaysReservationRecoveryExpectation,
} from './travelport-stays-reservation-response.ts';

const expectedReservation: TravelportStaysReservationRecoveryExpectation = Object.freeze({
  chainCode: 'HI',
  propertyCode: 'ABC12',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 2,
});

function response() {
  return {
    ReservationResponse: {
      Result: {
        '@type': 'Result',
        Warning: [{
          '@type': 'Warning',
          StatusCode: 99,
          Message: 'Rates unavailable for one unrelated property.',
        }],
      },
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [{
          '@type': 'Offer',
          id: 'O1',
          passiveOfferInd: false,
          Product: [{
            '@type': 'ProductHospitality',
            Quantity: 1,
            guests: 2,
            PropertyKey: {
              '@type': 'PropertyKey',
              chainCode: 'HI',
              propertyCode: 'ABC12',
            },
            DateRange: {
              start: '2026-10-10',
              end: '2026-10-12',
            },
          }],
        }],
        Receipt: [{
          Confirmation: {
            Locator: {
              value: 'D6VBHL',
              locatorType: 'PNR Locator',
              sourceContext: 'Travelport',
            },
            OfferStatus: { Status: 'Confirmed' },
          },
        }],
      },
      traceId: '5ba67b95-a9b2-4d0b-b3a2-b075969e79f1',
    },
  };
}

function expectInvalid(body: ReturnType<typeof response>, label: string) {
  assert.throws(
    () => parseTravelportStaysReservationResponse(body, {
      expectedProviderReservationReference: 'D6VBHL',
      expectedReservation,
      requireConfirmedTravelportReceipt: true,
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    label,
  );
}

test('known-locator response accepts canonical provider machine tokens', () => {
  const result = parseTravelportStaysReservationResponse(response(), {
    expectedProviderReservationReference: 'D6VBHL',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  });

  assert.deepEqual(result, {
    providerReservationReference: 'D6VBHL',
    supplierConfirmationReference: null,
    providerCorrelationId: '5ba67b95-a9b2-4d0b-b3a2-b075969e79f1',
  });
});

test('known-locator response does not trim provider machine authority into canonical evidence', () => {
  const variants: Array<readonly [string, (body: ReturnType<typeof response>) => void]> = [
    ['result type', (body) => { body.ReservationResponse.Result['@type'] = ' Result'; }],
    ['warning type', (body) => { body.ReservationResponse.Result.Warning[0]!['@type'] = 'Warning '; }],
    ['reservation type', (body) => { body.ReservationResponse.Reservation['@type'] = ' ReservationDetail'; }],
    ['offer type', (body) => { body.ReservationResponse.Reservation.Offer[0]!['@type'] = 'Offer '; }],
    ['offer id', (body) => { body.ReservationResponse.Reservation.Offer[0]!.id = ' O1'; }],
    ['product type', (body) => { body.ReservationResponse.Reservation.Offer[0]!.Product[0]!['@type'] = 'ProductHospitality '; }],
    ['property-key type', (body) => { body.ReservationResponse.Reservation.Offer[0]!.Product[0]!.PropertyKey['@type'] = ' PropertyKey'; }],
    ['chain code', (body) => { body.ReservationResponse.Reservation.Offer[0]!.Product[0]!.PropertyKey.chainCode = 'HI '; }],
    ['property code', (body) => { body.ReservationResponse.Reservation.Offer[0]!.Product[0]!.PropertyKey.propertyCode = ' ABC12'; }],
    ['arrival date', (body) => { body.ReservationResponse.Reservation.Offer[0]!.Product[0]!.DateRange.start = '2026-10-10 '; }],
    ['departure date', (body) => { body.ReservationResponse.Reservation.Offer[0]!.Product[0]!.DateRange.end = ' 2026-10-12'; }],
  ];

  for (const [label, mutate] of variants) {
    const body = response();
    mutate(body);
    expectInvalid(body, `${label} must fail closed`);
  }
});

test('known-locator response rejects embedded ASCII controls in provider machine authority', () => {
  const variants: Array<readonly [string, (body: ReturnType<typeof response>) => void]> = [
    ['result type', (body) => { body.ReservationResponse.Result['@type'] = 'Res\tult'; }],
    ['reservation type', (body) => { body.ReservationResponse.Reservation['@type'] = 'Reservation\u0000Detail'; }],
    ['offer id', (body) => { body.ReservationResponse.Reservation.Offer[0]!.id = 'O\u007f1'; }],
    ['product type', (body) => { body.ReservationResponse.Reservation.Offer[0]!.Product[0]!['@type'] = 'Product\u001fHospitality'; }],
    ['property code', (body) => { body.ReservationResponse.Reservation.Offer[0]!.Product[0]!.PropertyKey.propertyCode = 'ABC\t12'; }],
    ['arrival date', (body) => { body.ReservationResponse.Reservation.Offer[0]!.Product[0]!.DateRange.start = '2026-10-10\u0000'; }],
  ];

  for (const [label, mutate] of variants) {
    const body = response();
    mutate(body);
    expectInvalid(body, `${label} containing an ASCII control must fail closed`);
  }
});

test('provider correlation is exact operational evidence and is never normalized from padded or control-bearing text', () => {
  for (const traceId of [
    ' 5ba67b95-a9b2-4d0b-b3a2-b075969e79f1',
    '5ba67b95-a9b2-4d0b-b3a2-b075969e79f1 ',
    '5ba67b95-a9b2-4d0b-b3a2-b075969e79f1\u0000suffix',
    'trace\u007fvalue',
  ]) {
    const body = response();
    body.ReservationResponse.traceId = traceId;
    const result = parseTravelportStaysReservationResponse(body, {
      expectedProviderReservationReference: 'D6VBHL',
      expectedReservation,
      requireConfirmedTravelportReceipt: true,
    });
    assert.equal(result.providerCorrelationId, null, `trace ${JSON.stringify(traceId)} must not be normalized`);
  }
});

test('free-form warning text keeps bounded whitespace compatibility while rejecting controls', () => {
  const paddedMessage = response();
  paddedMessage.ReservationResponse.Result.Warning[0]!.Message = '  Rates unavailable for one unrelated property.  ';
  const accepted = parseTravelportStaysReservationResponse(paddedMessage, {
    expectedProviderReservationReference: 'D6VBHL',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  });
  assert.equal(accepted.providerReservationReference, 'D6VBHL');

  const controlMessage = response();
  controlMessage.ReservationResponse.Result.Warning[0]!.Message = 'Rates unavailable\tfor one property.';
  expectInvalid(controlMessage, 'warning text with an ASCII control must fail closed');
});
