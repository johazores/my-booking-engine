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

function activeOffer() {
  return {
    '@type': 'Offer',
    id: 'O1',
    Identifier: { authority: 'BKNG' },
    Product: [{
      '@type': 'ProductHospitality',
      Quantity: 1,
      guests: 2,
      PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' },
      DateRange: { start: '2026-10-10', end: '2026-10-12' },
    }],
  };
}

function activeReceipts() {
  return [
    {
      '@type': 'ReceiptConfirmation',
      OfferRef: ['O1'],
      Confirmation: {
        '@type': 'ConfirmationHold',
        Locator: {
          value: '80073065',
          locatorType: 'Confirmation Number',
          sourceContext: 'Supplier',
          source: 'BO',
        },
        OfferStatus: { '@type': 'OfferStatusHospitality', Status: 'Confirmed' },
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
  ];
}

function successBody() {
  return {
    ReservationResponse: {
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [activeOffer()],
        Receipt: activeReceipts(),
      },
      traceId: 'null-envelope-result-evidence',
    },
  };
}

function assertInvalidCreate(body: unknown, httpStatus = 200) {
  assert.deepEqual(
    classifyTravelportStaysReservationCreateOutcome({
      httpStatus,
      body,
      expectedReservation,
    }),
    {
      status: 'AMBIGUOUS',
      failureCode: 'INVALID_RESPONSE',
      supplierConfirmationReference: null,
      providerCorrelationId: null,
    },
  );
}

function assertInvalidRetrieve(body: unknown) {
  assert.throws(
    () => parseTravelportStaysReservationResponse(body, {
      expectedProviderReservationReference: 'D6VBHL',
      expectedReservation,
      requireConfirmedTravelportReceipt: true,
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
}

test('genuinely omitted response sibling and Result remain valid authority evidence', () => {
  const body = successBody();
  assert.equal(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body,
    expectedReservation,
  }).status, 'CONFIRMED');

  assert.equal(parseTravelportStaysReservationResponse(body, {
    expectedProviderReservationReference: 'D6VBHL',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  }).providerReservationReference, 'D6VBHL');
});

test('explicit null top-level ErrorResponse cannot disappear beside successful reservation evidence', () => {
  const body = { ...successBody(), ErrorResponse: null };
  assertInvalidCreate(body);
  assertInvalidRetrieve(body);
});

test('explicit null top-level ReservationResponse cannot disappear beside review-looking error evidence', () => {
  const body = {
    ReservationResponse: null,
    ErrorResponse: {
      traceId: 'null-reservation-sibling',
      Result: {
        Error: [{
          StatusCode: 400,
          SourceCode: '13020',
          category: 'VALIDATION',
          Message: 'provider text is not durable authority',
        }],
      },
    },
  };

  assertInvalidCreate(body, 400);
});

test('explicit null Result and Result members cannot be treated as omitted provider evidence', () => {
  for (const result of [
    null,
    { Error: null },
    { Errors: null },
    { Warning: null },
    { Warnings: null },
    { Warning: null, Warnings: [{ Message: 'conflicting warning family' }] },
  ]) {
    const body = successBody();
    body.ReservationResponse.Result = result;
    assertInvalidCreate(body);
    assertInvalidRetrieve(body);
  }
});

test('passive placeholder requires Locator to be genuinely absent rather than explicitly null', () => {
  const body = successBody();
  body.ReservationResponse.Reservation.Offer.push({
    '@type': 'Offer',
    id: 'O2',
    passiveOfferInd: true,
    Identifier: { authority: 'Travelport' },
    Product: [],
  });
  body.ReservationResponse.Reservation.Receipt.push({
    '@type': 'ReceiptConfirmation',
    OfferRef: ['O2'],
    Confirmation: {
      '@type': 'ConfirmationHold',
      OfferStatus: {
        '@type': 'OfferStatusHospitality',
        code: 'AK',
        Status: 'Confirmed',
      },
    },
  });

  assert.equal(parseTravelportStaysReservationResponse(body, {
    expectedProviderReservationReference: 'D6VBHL',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  }).providerReservationReference, 'D6VBHL');

  const explicitNullLocator = structuredClone(body);
  const passiveReceipt = explicitNullLocator.ReservationResponse.Reservation.Receipt[2];
  passiveReceipt.Confirmation.Locator = null;
  assertInvalidRetrieve(explicitNullLocator);
});
