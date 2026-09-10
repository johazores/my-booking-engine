import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { classifyTravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';
import { parseTravelportStaysReservationResponse } from './travelport-stays-reservation-response.ts';

const expectedReservation = Object.freeze({
  chainCode: 'XV',
  propertyCode: '89550',
  arrivalDateLocal: '2026-10-16',
  departureDateLocal: '2026-10-17',
  rooms: 1,
  guests: 1,
});

function receipt(input: Readonly<{
  value: string;
  locatorType: string;
  sourceContext: string;
  source?: string;
  status?: string;
}>) {
  return {
    '@type': 'ReceiptConfirmation',
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: input.value,
        locatorType: input.locatorType,
        sourceContext: input.sourceContext,
        ...(input.source ? { source: input.source } : {}),
      },
      OfferStatus: { Status: input.status ?? 'Confirmed' },
    },
  };
}

function response() {
  return {
    ReservationResponse: {
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [{
          '@type': 'Offer',
          Identifier: { authority: 'TVPT' },
          Product: [{
            '@type': 'ProductHospitality',
            Quantity: 1,
            guests: 1,
            PropertyKey: { chainCode: 'XV', propertyCode: '89550' },
            DateRange: { start: '2026-10-16', end: '2026-10-17' },
          }],
        }],
        Receipt: [
          receipt({
            value: '80073065',
            locatorType: 'Confirmation Number',
            sourceContext: 'Supplier',
            source: 'XV',
          }),
          receipt({ value: '96120603', locatorType: 'IATA Number', sourceContext: 'Agency' }),
          receipt({ value: 'D6VBHL', locatorType: 'PNR Locator', sourceContext: 'Travelport' }),
        ],
      },
      traceId: '25fb1289-7079-4151-b51e-a201cb83ffcc',
    },
  };
}

function expectInvalidCreate(body: unknown) {
  const result = classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body,
    expectedReservation,
  });
  assert.equal(result.status, 'AMBIGUOUS');
  if (result.status === 'AMBIGUOUS') assert.equal(result.failureCode, 'INVALID_RESPONSE');
}

test('Retrieve and Create reject malformed Stays receipt structure beside otherwise valid authority', () => {
  for (const malformedReceipt of [
    null,
    { '@type': 'UnknownReceipt' },
    { '@type': 'ReceiptConfirmation' },
    { '@type': 'ReceiptConfirmation', Confirmation: {} },
    {
      '@type': 'ReceiptConfirmation',
      Confirmation: { Locator: { value: 'D6VBHL', sourceContext: 'Travelport' } },
    },
  ]) {
    const body = response();
    body.ReservationResponse.Reservation.Receipt.push(malformedReceipt as never);

    assert.throws(
      () => parseTravelportStaysReservationResponse(body),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
    expectInvalidCreate(body);
  }
});

test('unrelated bounded multi-content receipts do not become or corrupt Stays locator authority', () => {
  const body = response();
  body.ReservationResponse.Reservation.Receipt.push(
    { '@type': 'ReceiptPayment', Document: [{ Number: '0019905292727' }] } as never,
    {
      '@type': 'ReceiptConfirmation',
      Confirmation: {
        '@type': 'ConfirmationHold',
        Locator: { source: 'AA', sourceContext: 'OrderId', value: 'AA001HD1YYTA7' },
      },
    } as never,
  );

  assert.equal(parseTravelportStaysReservationResponse(body).providerReservationReference, 'D6VBHL');
  assert.equal(
    classifyTravelportStaysReservationCreateOutcome({ httpStatus: 200, body, expectedReservation }).status,
    'CONFIRMED',
  );
});

test('Create and active Retrieve reject supplier cancellation evidence as contradictory active-booking authority', () => {
  const body = response();
  body.ReservationResponse.Reservation.Receipt[0] = receipt({
    value: '59824913',
    locatorType: 'Cancellation Number',
    sourceContext: 'Supplier',
    source: 'TX',
    status: 'Cancelled',
  });

  assert.throws(
    () => parseTravelportStaysReservationResponse(body, { requireConfirmedTravelportReceipt: true }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
  expectInvalidCreate(body);
});