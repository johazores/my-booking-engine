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

type OfferRefShape = 'absent' | 'null' | 'hotel';

function scopedReceipt(input: Readonly<{
  sourceContext: 'Travelport' | 'Supplier';
  locatorType: 'PNR Locator' | 'Confirmation Number';
  value: string;
  offerRef: OfferRefShape;
}>) {
  return {
    '@type': 'ReceiptConfirmation',
    ...(input.offerRef === 'absent'
      ? {}
      : { OfferRef: input.offerRef === 'null' ? null : ['O1'] }),
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: input.value,
        locatorType: input.locatorType,
        ...(input.sourceContext === 'Supplier' ? { source: 'BO' } : {}),
        sourceContext: input.sourceContext,
      },
      OfferStatus: {
        '@type': 'OfferStatusHospitality',
        Status: 'Confirmed',
      },
    },
  };
}

function response(input: Readonly<{
  supplierOfferRef?: OfferRefShape;
  travelportOfferRef?: OfferRefShape;
}> = {}) {
  return {
    ReservationResponse: {
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [{
          '@type': 'Offer',
          id: 'O1',
          Identifier: { authority: 'BKNG' },
          Product: [{
            '@type': 'ProductHospitality',
            Quantity: 1,
            guests: 2,
            PropertyKey: {
              '@type': 'PropertyKey',
              chainCode: 'CN',
              propertyCode: 'B6381',
            },
            DateRange: {
              start: '2026-10-10',
              end: '2026-10-12',
            },
          }],
        }],
        Receipt: [
          scopedReceipt({
            sourceContext: 'Supplier',
            locatorType: 'Confirmation Number',
            value: 'T9RY0-WQ842',
            offerRef: input.supplierOfferRef ?? 'hotel',
          }),
          scopedReceipt({
            sourceContext: 'Travelport',
            locatorType: 'PNR Locator',
            value: '0GQ9HS',
            offerRef: input.travelportOfferRef ?? 'absent',
          }),
        ],
      },
      traceId: 'explicit-null-offer-ref',
    },
  };
}

const invalidCreate = Object.freeze({
  status: 'AMBIGUOUS' as const,
  failureCode: 'INVALID_RESPONSE' as const,
  supplierConfirmationReference: null,
  providerCorrelationId: 'explicit-null-offer-ref',
});

const invalidSync = Object.freeze({
  status: 'AMBIGUOUS' as const,
  failureCode: 'INVALID_RESPONSE' as const,
  providerCorrelationId: 'explicit-null-offer-ref',
});

function assertRetrieveInvalid(body: unknown) {
  assert.throws(
    () => parseTravelportStaysReservationResponse(body, {
      expectedProviderReservationReference: '0GQ9HS',
      expectedReservation,
      requireConfirmedTravelportReceipt: true,
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
}

test('Create rejects explicit null OfferRef on reservation-level Travelport PNR evidence', () => {
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: response({ travelportOfferRef: 'null' }),
    expectedReservation,
  }), invalidCreate);
});

test('Create rejects explicit null OfferRef on single-offer supplier confirmation evidence', () => {
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: response({ supplierOfferRef: 'null' }),
    expectedReservation,
  }), invalidCreate);
});

test('Booking.com Sync inherits explicit-null PNR scope rejection', () => {
  assert.deepEqual(classifyTravelportStaysReservationSyncOutcome({
    httpStatus: 200,
    body: response({ travelportOfferRef: 'null' }),
    expectedReservation,
    supplierConfirmationReference: 'T9RY0-WQ842',
  }), invalidSync);
});

test('Booking.com Sync inherits explicit-null supplier scope rejection', () => {
  assert.deepEqual(classifyTravelportStaysReservationSyncOutcome({
    httpStatus: 200,
    body: response({ supplierOfferRef: 'null' }),
    expectedReservation,
    supplierConfirmationReference: 'T9RY0-WQ842',
  }), invalidSync);
});

test('known-locator Retrieve rejects explicit null OfferRef on Travelport PNR evidence', () => {
  assertRetrieveInvalid(response({ travelportOfferRef: 'null' }));
});

test('known-locator Retrieve rejects explicit null OfferRef on supplier confirmation evidence', () => {
  assertRetrieveInvalid(response({ supplierOfferRef: 'null' }));
});

test('genuinely absent reservation-level PNR OfferRef remains accepted across Create, Sync, and Retrieve', () => {
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: response(),
    expectedReservation,
  }), {
    status: 'CONFIRMED',
    providerReservationReference: '0GQ9HS',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: 'explicit-null-offer-ref',
  });

  assert.deepEqual(classifyTravelportStaysReservationSyncOutcome({
    httpStatus: 200,
    body: response(),
    expectedReservation,
    supplierConfirmationReference: 'T9RY0-WQ842',
  }), {
    status: 'CONFIRMED',
    providerReservationReference: '0GQ9HS',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: 'explicit-null-offer-ref',
  });

  assert.deepEqual(parseTravelportStaysReservationResponse(response(), {
    expectedProviderReservationReference: '0GQ9HS',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  }), {
    providerReservationReference: '0GQ9HS',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: 'explicit-null-offer-ref',
  });
});
