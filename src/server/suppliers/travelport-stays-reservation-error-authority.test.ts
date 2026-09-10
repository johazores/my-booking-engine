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

function response(errors: readonly unknown[], resultType: unknown = 'Result') {
  return {
    ErrorResponse: {
      traceId: '4807ae55-722d-4935-93a9-e9f743625bf5',
      Result: {
        '@type': resultType,
        Error: errors,
      },
    },
  };
}

function providerError(SourceCode: string, category: unknown, StatusCode = 500) {
  return {
    '@type': 'ErrorDetail',
    StatusCode,
    SourceCode,
    category,
    SourceID: 'API',
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

function classifyBody(body: unknown, httpStatus = 500) {
  return classifyTravelportStaysReservationCreateOutcome({
    httpStatus,
    body,
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
  assertInvalid(classify([{
    '@type': 'ErrorDetail',
    SourceCode: '13034',
    category: 'UNKNOWN',
    SourceID: 'API',
    Message: 'missing status code',
  }]));
  assertInvalid(classify([providerError('13034', 'VALIDATION')]));
  assertInvalid(classify([
    providerError('13034', 'UNKNOWN'),
    providerError('13020', 'VALIDATION'),
  ]));
  assertInvalid(classify([
    providerError('13034', 'UNKNOWN'),
    {
      '@type': 'ErrorDetail',
      StatusCode: 500,
      Message: 'missing source code',
      category: 'UNKNOWN',
      SourceID: 'API',
    },
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

test('source-code authority requires the documented Result and ErrorDetail discriminators', () => {
  assertInvalid(classifyBody({
    ErrorResponse: {
      traceId: '4807ae55-722d-4935-93a9-e9f743625bf5',
      Result: { Error: [providerError('13020', 'VALIDATION')] },
    },
  }));
  for (const resultType of [null, '', 'ErrorResult', 'Result\n']) {
    assertInvalid(classifyBody(response([providerError('13020', 'VALIDATION')], resultType)));
  }

  for (const errorType of [undefined, null, '', 'Error', 'ErrorDetail\n']) {
    assertInvalid(classify([{
      ...providerError('13020', 'VALIDATION'),
      '@type': errorType,
    }]));
  }
});

test('source-code authority requires bounded SourceID and Message from the newer error shape', () => {
  for (const SourceID of [undefined, null, '', 'API\nsecret', 'x'.repeat(65)]) {
    assertInvalid(classify([{
      ...providerError('13020', 'VALIDATION'),
      SourceID,
    }]));
  }

  for (const Message of [undefined, null, '', 'unsafe\nmessage', 'x'.repeat(4097)]) {
    assertInvalid(classify([{
      ...providerError('13020', 'VALIDATION'),
      Message,
    }]));
  }
});

test('source-code authority rejects malformed SourceCode text instead of trimming line breaks into authority', () => {
  for (const SourceCode of [undefined, null, '', '13020\n', '\n13020', '13 020']) {
    assertInvalid(classify([{
      ...providerError('13020', 'VALIDATION'),
      SourceCode,
    }]));
  }
});

test('source-code authority accepts only the documented lowercase category member', () => {
  assert.deepEqual(classify([providerError('13020', 'validation')]), {
    status: 'REVIEW_REQUIRED',
    reason: 'PRICE_CHANGED',
    providerCorrelationId: '4807ae55-722d-4935-93a9-e9f743625bf5',
  });

  for (const error of [
    { ...providerError('13020', undefined), Category: 'VALIDATION' },
    { ...providerError('13020', null), Category: 'VALIDATION' },
    { ...providerError('13020', 'VALIDATION'), Category: 'VALIDATION' },
    { ...providerError('13020', 'VALIDATION'), Category: 'UNKNOWN' },
    { ...providerError('13020', 'VALIDATION\n') },
    { ...providerError('13020', '\nVALIDATION') },
  ]) {
    assertInvalid(classify([error]));
  }
});

test('error authority rejects competing plural-error and warning evidence even when Error is otherwise valid', () => {
  for (const sibling of [
    { Errors: null },
    { Errors: [] },
    { Warning: null },
    { Warning: [] },
    { Warnings: null },
    { Warnings: [] },
  ]) {
    const body = response([providerError('13020', 'VALIDATION')]);
    Object.assign(body.ErrorResponse.Result, sibling);
    assertInvalid(classifyBody(body));
  }
});
