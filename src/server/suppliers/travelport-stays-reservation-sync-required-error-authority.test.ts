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

const correlationId = '4807ae55-722d-4935-93a9-e9f743625bf5';

function errorResponse(input: Readonly<{
  httpStatus: number;
  category?: string;
  sourceCodes?: readonly string[];
}>) {
  const sourceCodes = input.sourceCodes ?? ['13034'];
  return {
    ErrorResponse: {
      traceId: correlationId,
      Result: {
        '@type': 'Result',
        Error: sourceCodes.map((SourceCode) => ({
          '@type': 'ErrorDetail',
          StatusCode: input.httpStatus,
          SourceCode,
          category: input.category ?? 'UNKNOWN',
          SourceID: 'API',
          Message: 'bounded provider message',
        })),
      },
    },
  };
}

function classify(httpStatus: number, body = errorResponse({ httpStatus })) {
  return classifyTravelportStaysReservationCreateOutcome({
    httpStatus,
    body,
    expectedReservation,
  });
}

const invalidOutcome = Object.freeze({
  status: 'AMBIGUOUS' as const,
  failureCode: 'INVALID_RESPONSE' as const,
  supplierConfirmationReference: null,
  providerCorrelationId: correlationId,
});

test('recognizes source code 13034 only at the documented HTTP 500 UNKNOWN boundary', () => {
  assert.deepEqual(classify(500), {
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SYNC_REQUIRED',
    supplierConfirmationReference: null,
    providerCorrelationId: correlationId,
  });

  for (const status of [400, 404]) {
    assert.deepEqual(classify(status), invalidOutcome);
  }
});

test('keeps malformed or contradictory 13034 machine evidence fail closed', () => {
  assert.deepEqual(classify(500, errorResponse({ httpStatus: 500, category: 'VALIDATION' })), invalidOutcome);
  assert.deepEqual(classify(500, errorResponse({ httpStatus: 500, sourceCodes: ['13034', '13020'] })), invalidOutcome);
});