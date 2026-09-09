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

function response(passiveOfferRef: unknown = 'O2') {
  return {
    ReservationResponse: {
      Reservation: {
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
            OfferRef: [passiveOfferRef],
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
      traceId: '8c0ff96b-b0d9-493d-83a4-a3fb8cbc943f',
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

test('known-locator recovery ignores the documented locator-less receipt scoped to an explicit passive placeholder', () => {
  assert.deepEqual(parse(response()), {
    providerReservationReference: 'D6VBHL',
    supplierConfirmationReference: '80073065',
    providerCorrelationId: '8c0ff96b-b0d9-493d-83a4-a3fb8cbc943f',
  });
});

test('locator-less receipt evidence cannot disappear when its offer reference is not an explicit passive offer', () => {
  assert.throws(
    () => parse(response('O3')),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('receipt evidence cannot mix active and passive offer references', () => {
  const body = response();
  body.ReservationResponse.Reservation.Receipt[1]!.OfferRef = ['O1', 'O2'];
  assert.throws(
    () => parse(body),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('passive offer scoping cannot hide durable PNR evidence', () => {
  const body = response();
  body.ReservationResponse.Reservation.Receipt[1] = {
    '@type': 'ReceiptConfirmation',
    OfferRef: ['O2'],
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: 'OTHER',
        locatorType: 'PNR Locator',
        sourceContext: 'Travelport',
      },
      OfferStatus: { '@type': 'OfferStatusHospitality', Status: 'Confirmed' },
    },
  } as never;
  assert.throws(
    () => parse(body),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('only the documented AK locator-less placeholder shape is excluded', () => {
  const body = response();
  body.ReservationResponse.Reservation.Receipt[1]!.Confirmation.OfferStatus.code = 'MK';
  assert.throws(
    () => parse(body),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('malformed passive receipt offer references remain fail closed', () => {
  for (const malformed of [null, [], [null], ['O2\nsecret']]) {
    const body = response();
    body.ReservationResponse.Reservation.Receipt[1]!.OfferRef = malformed as never;
    assert.throws(
      () => parse(body),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('all receipt offer references must resolve to a returned reservation offer', () => {
  const body = response();
  body.ReservationResponse.Reservation.Receipt[0]!.OfferRef = ['O3'];
  assert.throws(
    () => parse(body),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('reservation offer identifiers must be present, bounded, and unique before receipt scoping', () => {
  for (const malformedId of [undefined, '', 'O1', 'O2\nsecret']) {
    const body = response();
    body.ReservationResponse.Reservation.Offer[1]!.id = malformedId as never;
    assert.throws(
      () => parse(body),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('passive supplier confirmation cannot satisfy active reservation supplier authority', () => {
  const body = response();
  body.ReservationResponse.Reservation.Receipt.splice(1, 1);
  body.ReservationResponse.Reservation.Receipt[0]!.OfferRef = ['O2'];

  assert.deepEqual(parse(body), {
    providerReservationReference: 'D6VBHL',
    supplierConfirmationReference: null,
    providerCorrelationId: '8c0ff96b-b0d9-493d-83a4-a3fb8cbc943f',
  });
});

test('malformed passive supplier confirmation cannot be hidden by passive scoping', () => {
  const body = response();
  body.ReservationResponse.Reservation.Receipt.splice(1, 1);
  body.ReservationResponse.Reservation.Receipt[0]!.OfferRef = ['O2'];
  body.ReservationResponse.Reservation.Receipt[0]!.Confirmation.OfferStatus['@type'] = 'OfferStatusAir';

  assert.throws(
    () => parse(body),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});
