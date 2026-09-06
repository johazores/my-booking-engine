import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyTravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';

const expectedReservation = Object.freeze({
  chainCode: 'CN',
  propertyCode: 'B6381',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 2,
});

function confirmedResponse(input: { includeTravelport?: boolean; warning?: string; propertyCode?: string } = {}) {
  return {
    ReservationResponse: {
      Reservation: {
        Offer: [{
          '@type': 'Offer',
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
              Locator: { value: 'T9RY0-WQ842', locatorType: 'Confirmation Number', source: 'BO', sourceContext: 'Supplier' },
              OfferStatus: { Status: 'Confirmed' },
            },
          },
          ...(input.includeTravelport === false ? [] : [{
            Confirmation: {
              Locator: { value: '0GQ9HS', locatorType: 'PNR Locator', sourceContext: 'Travelport' },
              OfferStatus: { Status: 'Confirmed' },
            },
          }]),
        ],
      },
      ...(input.warning ? { Result: { Warning: [{ Message: input.warning }] } } : {}),
      traceId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
    },
  };
}

function errorResponse(sourceCode: string) {
  return errorResponseCodes([sourceCode]);
}

function errorResponseCodes(sourceCodes: readonly string[]) {
  return {
    ErrorResponse: {
      traceId: '4807ae55-722d-4935-93a9-e9f743625bf5',
      Result: { Error: sourceCodes.map((SourceCode) => ({ SourceCode, Message: 'provider message intentionally ignored' })) },
    },
  };
}

function hybridResponse(sourceCodes: readonly string[]) {
  return { ...confirmedResponse(), ...errorResponseCodes(sourceCodes) };
}

const invalidOutcome = (providerCorrelationId: string | null = null) => ({
  status: 'AMBIGUOUS' as const,
  failureCode: 'INVALID_RESPONSE' as const,
  supplierConfirmationReference: null,
  providerCorrelationId,
});

test('confirms only one matching reservation with a confirmed Travelport locator', () => {
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: confirmedResponse(),
    expectedReservation,
  }), {
    status: 'CONFIRMED',
    providerReservationReference: '0GQ9HS',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
  });
});

test('classifies documented price and guarantee changes as review-required rather than retrying sell', () => {
  for (const sourceCode of ['13016', '13017', '13018']) {
    assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
      httpStatus: 400,
      body: errorResponse(sourceCode),
      expectedReservation,
    }), {
      status: 'REVIEW_REQUIRED',
      reason: 'GUARANTEE_CHANGED',
      providerCorrelationId: '4807ae55-722d-4935-93a9-e9f743625bf5',
    });
  }
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 400,
    body: errorResponse('13020'),
    expectedReservation,
  }), {
    status: 'REVIEW_REQUIRED',
    reason: 'PRICE_CHANGED',
    providerCorrelationId: '4807ae55-722d-4935-93a9-e9f743625bf5',
  });

  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 400,
    body: errorResponseCodes(['13017', '13020']),
    expectedReservation,
  }), {
    status: 'REVIEW_REQUIRED',
    reason: 'PRICE_AND_GUARANTEE_CHANGED',
    providerCorrelationId: '4807ae55-722d-4935-93a9-e9f743625bf5',
  });
});

test('source code 13034 always stays ambiguous because provider docs cannot distinguish no-sell from sold', () => {
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 500,
    body: errorResponse('13034'),
    expectedReservation,
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SYNC_REQUIRED',
    supplierConfirmationReference: null,
    providerCorrelationId: '4807ae55-722d-4935-93a9-e9f743625bf5',
  });
});

test('documented supplier-confirmed/no-PNR warning retains sync evidence only for the expected stay', () => {
  const warning = 'Hotel sell confirmed from supplier. Travelport PNR processing did not complete. Use SYNC message with confirmation number to complete PNR.';
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: confirmedResponse({ includeTravelport: false, warning }),
    expectedReservation,
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SYNC_REQUIRED',
    supplierConfirmationReference: 'T9RY0-WQ842',
    providerCorrelationId: '9457f5be-e648-4cb6-ac1f-1d349d06d6ce',
  });

  const mismatch = classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: confirmedResponse({ includeTravelport: false, warning, propertyCode: 'OTHER' }),
    expectedReservation,
  });
  assert.equal(mismatch.status, 'AMBIGUOUS');
  if (mismatch.status === 'AMBIGUOUS') assert.equal(mismatch.supplierConfirmationReference, null);
});

test('unknown or malformed write outcomes fail closed to ambiguous instead of becoming retryable failures', () => {
  for (const [httpStatus, body] of [
    [200, { ok: true }],
    [400, errorResponse('99999')],
    [400, errorResponseCodes(['13020', '99999'])],
    [503, { ErrorResponse: { Result: {} } }],
  ] as const) {
    assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({ httpStatus, body, expectedReservation }), invalidOutcome(
      httpStatus === 400 ? '4807ae55-722d-4935-93a9-e9f743625bf5' : null,
    ));
  }
});

test('error evidence can never be masked by confirmation-looking data', () => {
  for (const body of [
    hybridResponse(['99999']),
    hybridResponse(['13020', '99999']),
    { ...confirmedResponse(), ErrorResponse: { Result: {} } },
    { ...confirmedResponse(), ErrorResponse: { Result: { Error: Array.from({ length: 33 }, () => ({ SourceCode: '13020' })) } } },
    { ...confirmedResponse(), ErrorResponse: { Result: { Error: [{ SourceCode: '13020' }, { Message: 'missing code' }] } } },
  ]) {
    const result = classifyTravelportStaysReservationCreateOutcome({ httpStatus: 200, body, expectedReservation });
    assert.equal(result.status, 'AMBIGUOUS');
    if (result.status === 'AMBIGUOUS') assert.equal(result.failureCode, 'INVALID_RESPONSE');
  }
});

test('malformed or oversized warning structures can never be ignored on a confirmation-looking response', () => {
  const malformedWarnings = [
    { Result: { Warning: { Message: 'not an array' } } },
    { Result: { Warning: [{ Message: 'valid' }, {}] } },
    { Result: { Warning: Array.from({ length: 33 }, () => ({ Message: 'bounded warning' })) } },
    { Result: { Warning: [], Warnings: [] } },
  ];
  for (const resultShape of malformedWarnings) {
    const body = confirmedResponse();
    Object.assign(body.ReservationResponse, resultShape);
    assert.deepEqual(
      classifyTravelportStaysReservationCreateOutcome({ httpStatus: 200, body, expectedReservation }),
      invalidOutcome('9457f5be-e648-4cb6-ac1f-1d349d06d6ce'),
    );
  }
});

test('bounded non-sync warnings do not erase otherwise complete confirmation evidence', () => {
  const body = confirmedResponse();
  body.ReservationResponse.Result = { Warning: [{ Message: 'Late arrival note accepted.' }] };
  const result = classifyTravelportStaysReservationCreateOutcome({ httpStatus: 200, body, expectedReservation });
  assert.equal(result.status, 'CONFIRMED');
});

test('invalid expected reservation authority can never be confirmed from matching malformed input', () => {
  for (const expected of [
    { ...expectedReservation, arrivalDateLocal: '2026-02-30', departureDateLocal: '2026-03-02' },
    { ...expectedReservation, departureDateLocal: '2026-10-09' },
    { ...expectedReservation, rooms: 2 },
    { ...expectedReservation, guests: 10 },
    { ...expectedReservation, chainCode: 'CN\n' },
  ]) {
    assert.deepEqual(
      classifyTravelportStaysReservationCreateOutcome({ httpStatus: 200, body: confirmedResponse(), expectedReservation: expected }),
      invalidOutcome('9457f5be-e648-4cb6-ac1f-1d349d06d6ce'),
    );
  }
});

test('sync warning overrides otherwise confirmed-looking evidence and duplicate locators never confirm', () => {
  const warning = 'Hotel sell confirmed from supplier. Travelport PNR processing did not complete. Use SYNC message with confirmation number to complete PNR.';
  const warned = classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: confirmedResponse({ warning }),
    expectedReservation,
  });
  assert.equal(warned.status, 'AMBIGUOUS');
  if (warned.status === 'AMBIGUOUS') assert.equal(warned.failureCode, 'TRAVELPORT_SYNC_REQUIRED');

  const duplicate = confirmedResponse();
  duplicate.ReservationResponse.Reservation.Receipt.push({
    Confirmation: {
      Locator: { value: '0GQ9HS', locatorType: 'PNR Locator', sourceContext: 'Travelport' },
      OfferStatus: { Status: 'Confirmed' },
    },
  });
  const duplicateResult = classifyTravelportStaysReservationCreateOutcome({ httpStatus: 200, body: duplicate, expectedReservation });
  assert.equal(duplicateResult.status, 'AMBIGUOUS');
});

test('raw provider messages and unsafe correlation values never escape the classifier', () => {
  const body = errorResponse('13020');
  body.ErrorResponse.traceId = 'trace\nsecret';
  const result = classifyTravelportStaysReservationCreateOutcome({ httpStatus: 400, body, expectedReservation });
  assert.equal(result.providerCorrelationId, null);
  assert.equal('Message' in result, false);
  assert.equal(JSON.stringify(result).includes('provider message intentionally ignored'), false);
});
