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

function response(errors: readonly unknown[]) {
  return {
    ErrorResponse: {
      traceId: '4807ae55-722d-4935-93a9-e9f743625bf5',
      Result: { Error: errors },
    },
  };
}

function providerError(SourceCode: string, category: string, StatusCode = 500) {
  return {
    StatusCode,
    SourceCode,
    category,
    Message: 'provider message intentionally ignored',
  };
}

function classify(errors: readonly unknown[], httpStatus = 500) {
  return classifyTravelportStaysReservationCreateOutcome({
    httpStatus,
    body: response(errors),
    expectedReservation,
  });
}

function assertInvalid(result: ReturnType<typeof classify>) {
  assert.deepEqual(result, {
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    supplierConfirmationReference: null,
    providerCorrelationId: '4807ae55-722d-4935-93a9-e9f743625bf5',
  });
}

test('13034 requires a complete newer error envelope with UNKNOWN category', () => {
  assert.deepEqual(classify([providerError('13034', 'UNKNOWN')]), {
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SYNC_REQUIRED',
    supplierConfirmationReference: null,
    providerCorrelationId: '4807ae55-722d-4935-93a9-e9f743625bf5',
  });

  assertInvalid(classify([{ ...providerError('13034', 'UNKNOWN'), category: undefined }]));
  assertInvalid(classify([{ SourceCode: '13034', category: 'UNKNOWN', Message: 'missing status code' }]));
  assertInvalid(classify([providerError('13034', 'VALIDATION')]));
  assertInvalid(classify([
    providerError('13034', 'UNKNOWN'),
    providerError('13020', 'VALIDATION'),
  ]));
  assertInvalid(classify([
    providerError('13034', 'UNKNOWN'),
    { StatusCode: 500, Message: 'missing source code', category: 'UNKNOWN' },
  ]));
});

test('source-code authority requires body StatusCode to match the actual HTTP response', () => {
  assertInvalid(classify([providerError('13034', 'UNKNOWN', 400)], 500));
  assertInvalid(classify([{ ...providerError('13034', 'UNKNOWN'), StatusCode: '500' }], 500));
  assertInvalid(classify([providerError('13034', 'UNKNOWN', 99)], 500));
});

test('price and guarantee review decisions require complete VALIDATION evidence', () => {
  assert.deepEqual(classify([providerError('13020', 'VALIDATION')]), {
    status: 'REVIEW_REQUIRED',
    reason: 'PRICE_CHANGED',
    providerCorrelationId: '4807ae55-722d-4935-93a9-e9f743625bf5',
  });
  assert.deepEqual(classify([providerError('13017', 'VALIDATION')]), {
    status: 'REVIEW_REQUIRED',
    reason: 'GUARANTEE_CHANGED',
    providerCorrelationId: '4807ae55-722d-4935-93a9-e9f743625bf5',
  });

  assertInvalid(classify([{ ...providerError('13020', 'VALIDATION'), category: undefined }]));
  assertInvalid(classify([providerError('13020', 'UNKNOWN')]));
  assertInvalid(classify([providerError('13017', 'RETRY')]));
  assertInvalid(classify([
    providerError('13020', 'VALIDATION'),
    providerError('99999', 'VALIDATION'),
  ]));
});
