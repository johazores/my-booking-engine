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

function validationError(sourceCodes: readonly string[], category: string | null = 'VALIDATION') {
  return {
    ErrorResponse: {
      traceId: 'a6bbfb20-dc6f-4d74-b41f-62c714dd04f0',
      Result: {
        '@type': 'Result',
        Error: sourceCodes.map((SourceCode) => ({
          '@type': 'ErrorDetail',
          StatusCode: 400,
          SourceCode,
          ...(category === null ? {} : { category }),
          SourceID: 'API',
          Message: 'provider text is not durable authority',
        })),
      },
    },
  };
}

const retryablePaymentCodes = [
  '1537',
  '1538',
  '1539',
  '1540',
  '1541',
  '1542',
  '1543',
  '1544',
  '1545',
  '1546',
  '1547',
  '13050',
  '13054',
  '13078',
  '13083',
] as const;

test('allows a fresh-authority retry only for reviewed ephemeral payment/card/address/phone validation failures', () => {
  for (const sourceCode of retryablePaymentCodes) {
    assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
      httpStatus: 400,
      body: validationError([sourceCode]),
      expectedReservation,
    }), {
      status: 'FAILED',
      failureCode: `TRAVELPORT_VALIDATION_${sourceCode}`,
      retryable: true,
      providerCorrelationId: 'a6bbfb20-dc6f-4d74-b41f-62c714dd04f0',
    });
  }
});

test('keeps durable traveler and inventory validation failures non-retryable on the existing operation', () => {
  for (const sourceCode of ['1533', '1534', '13022'] as const) {
    assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
      httpStatus: 400,
      body: validationError([sourceCode]),
      expectedReservation,
    }), {
      status: 'FAILED',
      failureCode: `TRAVELPORT_VALIDATION_${sourceCode}`,
      retryable: false,
      providerCorrelationId: 'a6bbfb20-dc6f-4d74-b41f-62c714dd04f0',
    });
  }
});

test('requires explicit VALIDATION category before a payment correction can authorize retry', () => {
  for (const category of [null, 'UNKNOWN', 'RETRY']) {
    const outcome = classifyTravelportStaysReservationCreateOutcome({
      httpStatus: 400,
      body: validationError(['13050'], category),
      expectedReservation,
    });
    assert.equal(outcome.status, 'AMBIGUOUS');
    if (outcome.status === 'AMBIGUOUS') {
      assert.equal(outcome.failureCode, 'INVALID_RESPONSE');
    }
  }
});

test('mixed validation codes do not grant correction retry authority', () => {
  const outcome = classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 400,
    body: validationError(['1543', '13050']),
    expectedReservation,
  });
  assert.equal(outcome.status, 'AMBIGUOUS');
  if (outcome.status === 'AMBIGUOUS') {
    assert.equal(outcome.failureCode, 'INVALID_RESPONSE');
  }
});
