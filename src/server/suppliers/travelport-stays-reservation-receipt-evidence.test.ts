import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { classifyTravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';
import { parseTravelportStaysReservationResponse } from './travelport-stays-reservation-response.ts';

const expectedReservation = Object.freeze({
  chainCode: 'CN',
  propertyCode: 'B6381',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 2,
});

const syncWarning =
  'Hotel sell confirmed from supplier. Travelport PNR processing did not complete. Use SYNC message with confirmation number to complete PNR.';

function receipt(input: Readonly<{
  value: string;
  locatorType: string;
  sourceContext: string;
  status: string;
  source?: string;
}>) {
  return {
    Confirmation: {
      Locator: {
        value: input.value,
        locatorType: input.locatorType,
        sourceContext: input.sourceContext,
        ...(input.source ? { source: input.source } : {}),
      },
      OfferStatus: { Status: input.status },
    },
  };
}

function reservationResponse(input: Readonly<{
  includeTravelport?: boolean;
  warning?: string;
}> = {}) {
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
            PropertyKey: { chainCode: 'CN', propertyCode: 'B6381' },
            DateRange: { start: '2026-10-10', end: '2026-10-12' },
          }],
        }],
        Receipt: [
          receipt({
            value: 'T9RY0-WQ842',
            locatorType: 'Confirmation Number',
            sourceContext: 'Supplier',
            source: 'BO',
            status: 'Confirmed',
          }),
          ...(input.includeTravelport === false ? [] : [receipt({
            value: '0GQ9HS',
            locatorType: 'PNR Locator',
            sourceContext: 'Travelport',
            status: 'Confirmed',
          })]),
        ],
      },
      ...(input.warning ? { Result: { Warning: [{ Message: input.warning }] } } : {}),
      traceId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
    },
  };
}

function expectInvalidCreate(body: unknown) {
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body,
    expectedReservation,
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    supplierConfirmationReference: null,
    providerCorrelationId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
  });
}

test('retrieve cannot ignore a malformed relevant receipt beside otherwise valid locator evidence', () => {
  const malformedProvider = reservationResponse();
  malformedProvider.ReservationResponse.Reservation.Receipt.push(receipt({
    value: 'BAD\nPNR',
    locatorType: 'PNR Locator',
    sourceContext: 'Travelport',
    status: 'Confirmed',
  }));
  assert.throws(
    () => parseTravelportStaysReservationResponse(malformedProvider),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );

  const malformedSupplier = reservationResponse();
  malformedSupplier.ReservationResponse.Reservation.Receipt.push(receipt({
    value: 'BAD\nCONFIRMATION',
    locatorType: 'Confirmation Number',
    sourceContext: 'Supplier',
    source: 'BO',
    status: 'Confirmed',
  }));
  assert.throws(
    () => parseTravelportStaysReservationResponse(malformedSupplier),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('Create cannot confirm when another relevant PNR or supplier receipt is not confirmed', () => {
  const pendingProvider = reservationResponse();
  pendingProvider.ReservationResponse.Reservation.Receipt.push(receipt({
    value: '0GQ9HS',
    locatorType: 'PNR Locator',
    sourceContext: 'Travelport',
    status: 'Pending',
  }));
  expectInvalidCreate(pendingProvider);

  const pendingSupplier = reservationResponse();
  pendingSupplier.ReservationResponse.Reservation.Receipt.push(receipt({
    value: 'T9RY0-WQ842',
    locatorType: 'Confirmation Number',
    sourceContext: 'Supplier',
    source: 'BO',
    status: 'Pending',
  }));
  expectInvalidCreate(pendingSupplier);
});

test('Create cannot ignore malformed relevant locator evidence beside a valid confirmation', () => {
  const malformedProvider = reservationResponse();
  malformedProvider.ReservationResponse.Reservation.Receipt.push(receipt({
    value: 'BAD\nPNR',
    locatorType: 'PNR Locator',
    sourceContext: 'Travelport',
    status: 'Confirmed',
  }));
  expectInvalidCreate(malformedProvider);

  const malformedSupplier = reservationResponse();
  malformedSupplier.ReservationResponse.Reservation.Receipt.push(receipt({
    value: 'BAD\nCONFIRMATION',
    locatorType: 'Confirmation Number',
    sourceContext: 'Supplier',
    source: 'BO',
    status: 'Confirmed',
  }));
  expectInvalidCreate(malformedSupplier);
});

test('Create and Retrieve reject contradictory Stays source-context and locator-family pairs', () => {
  for (const conflictingReceipt of [
    receipt({
      value: 'WRONG-TRAVELPORT-FAMILY',
      locatorType: 'Confirmation Number',
      sourceContext: 'Travelport',
      status: 'Confirmed',
    }),
    receipt({
      value: 'WRONG-SUPPLIER-FAMILY',
      locatorType: 'PNR Locator',
      sourceContext: 'Supplier',
      status: 'Confirmed',
    }),
    receipt({
      value: 'WRONG-AGENCY-FAMILY',
      locatorType: 'Confirmation Number',
      sourceContext: 'Agency',
      status: 'Confirmed',
    }),
    receipt({
      value: 'WRONG-PNR-CONTEXT',
      locatorType: 'PNR Locator',
      sourceContext: 'Other',
      status: 'Confirmed',
    }),
    receipt({
      value: 'WRONG-CONFIRMATION-CONTEXT',
      locatorType: 'Confirmation Number',
      sourceContext: 'VendorLocator',
      status: 'Confirmed',
    }),
  ]) {
    const body = reservationResponse();
    body.ReservationResponse.Reservation.Receipt.push(conflictingReceipt);
    assert.throws(
      () => parseTravelportStaysReservationResponse(body),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
    expectInvalidCreate(body);
  }
});

test('Sync recovery authority requires absence of any Travelport PNR receipt, not just absence of a confirmed one', () => {
  const body = reservationResponse({ includeTravelport: false, warning: syncWarning });
  body.ReservationResponse.Reservation.Receipt.push(receipt({
    value: '0GQ9HS',
    locatorType: 'PNR Locator',
    sourceContext: 'Travelport',
    status: 'Pending',
  }));
  expectInvalidCreate(body);
});
