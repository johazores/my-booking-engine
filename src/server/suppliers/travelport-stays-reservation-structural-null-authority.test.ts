import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { classifyTravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';
import { parseTravelportStaysReservationResponse } from './travelport-stays-reservation-response.ts';
import { classifyTravelportStaysReservationSyncOutcome } from './travelport-stays-reservation-sync-domain.ts';

const expectedReservation = Object.freeze({
  chainCode: 'CN',
  propertyCode: 'B6381',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 2,
});

const providerReservationReference = '0GQ9HS';
const supplierConfirmationReference = 'T9RY0-WQ842';
const providerCorrelationId = 'structural-null-authority';

function receiptEvidence() {
  return [
    {
      '@type': 'ReceiptConfirmation',
      OfferRef: ['O1'],
      Confirmation: {
        '@type': 'ConfirmationHold',
        Locator: {
          value: supplierConfirmationReference,
          locatorType: 'Confirmation Number',
          source: 'BO',
          sourceContext: 'Supplier',
        },
        OfferStatus: { '@type': 'OfferStatusHospitality', Status: 'Confirmed' },
      },
    },
    {
      '@type': 'ReceiptConfirmation',
      Confirmation: {
        '@type': 'ConfirmationHold',
        Locator: {
          value: providerReservationReference,
          locatorType: 'PNR Locator',
          sourceContext: 'Travelport',
        },
        OfferStatus: { '@type': 'OfferStatusHospitality', Status: 'Confirmed' },
      },
    },
  ];
}

function commercialResponse(input: Readonly<{
  propertyKeyType?: unknown;
  omitPropertyKeyType?: boolean;
  offerId?: unknown;
  omitOfferId?: boolean;
}> = {}) {
  const propertyKey: Record<string, unknown> = {
    chainCode: 'CN',
    propertyCode: 'B6381',
  };
  if (!input.omitPropertyKeyType) {
    propertyKey['@type'] = input.propertyKeyType === undefined ? 'PropertyKey' : input.propertyKeyType;
  }

  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    Identifier: { authority: 'BKNG' },
    Product: [{
      '@type': 'ProductHospitality',
      Quantity: 1,
      guests: 2,
      PropertyKey: propertyKey,
      DateRange: { start: '2026-10-10', end: '2026-10-12' },
    }],
  };
  if (!input.omitOfferId) {
    offer.id = input.offerId === undefined ? 'O1' : input.offerId;
  }

  return {
    ReservationResponse: {
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [offer],
        Receipt: receiptEvidence(),
      },
      traceId: providerCorrelationId,
    },
  };
}

function retrieveResponse(input: Readonly<{
  propertyKeyType?: unknown;
  omitPropertyKeyType?: boolean;
  passiveOfferInd?: unknown;
  omitPassiveOfferInd?: boolean;
}> = {}) {
  const propertyKey: Record<string, unknown> = {
    chainCode: 'CN',
    propertyCode: 'B6381',
  };
  if (!input.omitPropertyKeyType) {
    propertyKey['@type'] = input.propertyKeyType === undefined ? 'PropertyKey' : input.propertyKeyType;
  }

  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    id: 'O1',
    Product: [{
      '@type': 'ProductHospitality',
      Quantity: 1,
      guests: 2,
      PropertyKey: propertyKey,
      DateRange: { start: '2026-10-10', end: '2026-10-12' },
    }],
  };
  if (!input.omitPassiveOfferInd) {
    offer.passiveOfferInd = input.passiveOfferInd === undefined ? false : input.passiveOfferInd;
  }

  return {
    ReservationResponse: {
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [offer],
        Receipt: receiptEvidence(),
      },
      traceId: providerCorrelationId,
    },
  };
}

const invalidCreate = Object.freeze({
  status: 'AMBIGUOUS' as const,
  failureCode: 'INVALID_RESPONSE' as const,
  supplierConfirmationReference: null,
  providerCorrelationId,
});

const invalidSync = Object.freeze({
  status: 'AMBIGUOUS' as const,
  failureCode: 'INVALID_RESPONSE' as const,
  providerCorrelationId,
});

function assertInvalidRetrieve(body: unknown) {
  assert.throws(
    () => parseTravelportStaysReservationResponse(body, {
      expectedProviderReservationReference: providerReservationReference,
      expectedReservation,
      requireConfirmedTravelportReceipt: true,
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
}

test('genuine omission remains compatible at the documented structural compatibility boundaries', () => {
  const commercialBody = commercialResponse({
    omitPropertyKeyType: true,
    omitOfferId: true,
  });
  assert.equal(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: commercialBody,
    expectedReservation,
  }).status, 'CONFIRMED');
  assert.equal(classifyTravelportStaysReservationSyncOutcome({
    httpStatus: 200,
    body: commercialBody,
    expectedReservation,
    supplierConfirmationReference,
  }).status, 'CONFIRMED');

  const recovered = parseTravelportStaysReservationResponse(retrieveResponse({
    omitPropertyKeyType: true,
    omitPassiveOfferInd: true,
  }), {
    expectedProviderReservationReference: providerReservationReference,
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  });
  assert.equal(recovered.providerReservationReference, providerReservationReference);
});

test('explicit-null PropertyKey type cannot become reservation identity authority', () => {
  const commercialBody = commercialResponse({ propertyKeyType: null });
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: commercialBody,
    expectedReservation,
  }), invalidCreate);
  assert.deepEqual(classifyTravelportStaysReservationSyncOutcome({
    httpStatus: 200,
    body: commercialBody,
    expectedReservation,
    supplierConfirmationReference,
  }), invalidSync);
  assertInvalidRetrieve(retrieveResponse({ propertyKeyType: null }));
});

test('commercial single-offer compatibility requires Offer.id to be genuinely omitted, not explicit null', () => {
  const body = commercialResponse({ offerId: null });
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body,
    expectedReservation,
  }), invalidCreate);
  assert.deepEqual(classifyTravelportStaysReservationSyncOutcome({
    httpStatus: 200,
    body,
    expectedReservation,
    supplierConfirmationReference,
  }), invalidSync);
});

test('known-locator passive scope rejects explicit-null passiveOfferInd while genuine omission stays non-passive', () => {
  assertInvalidRetrieve(retrieveResponse({ passiveOfferInd: null }));

  const recovered = parseTravelportStaysReservationResponse(retrieveResponse({ omitPassiveOfferInd: true }), {
    expectedProviderReservationReference: providerReservationReference,
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  });
  assert.equal(recovered.providerReservationReference, providerReservationReference);
});
