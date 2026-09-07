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

function errorResponse(errors: readonly Readonly<{
  sourceCode: string;
  category?: string;
}>[]) {
  return {
    ErrorResponse: {
      traceId: '4807ae55-722d-4935-93a9-e9f743625bf5',
      Result: {
        Error: errors.map((error) => ({
          SourceCode: error.sourceCode,
          ...(error.category === undefined ? {} : { category: error.category }),
          Message: 'provider message intentionally ignored',
        })),
      },
    },
  };
}

test('documented validation failures with no-sell semantics settle as definitive failures', () => {
  for (const sourceCode of ['1200', '1250', '13003', '13022', '13046', '13064']) {
    assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
      httpStatus: 400,
      body: errorResponse([{ sourceCode, category: 'VALIDATION' }]),
      expectedReservation,
    }), {
      status: 'FAILED',
      failureCode: `TRAVELPORT_VALIDATION_${sourceCode}`,
      retryable: false,
      providerCorrelationId: '4807ae55-722d-4935-93a9-e9f743625bf5',
    });
  }
});

test('ephemeral form-of-payment validation rejections are retryable only when Travelport proves no sell occurred', () => {
  for (const sourceCode of [
    '1537', '1538', '1539', '1540', '1541', '1542', '1543', '1544', '1545', '1546', '1547',
    '13050', '13054', '13078', '13083',
  ]) {
    assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
      httpStatus: 400,
      body: errorResponse([{ sourceCode, category: 'validation' }]),
      expectedReservation,
    }), {
      status: 'FAILED',
      failureCode: `TRAVELPORT_VALIDATION_${sourceCode}`,
      retryable: true,
      providerCorrelationId: '4807ae55-722d-4935-93a9-e9f743625bf5',
    });
  }
});

test('missing, non-validation, mixed, or unknown provider error evidence remains ambiguous', () => {
  for (const errors of [
    [{ sourceCode: '13046' }],
    [{ sourceCode: '13046', category: 'UNKNOWN' }],
    [{ sourceCode: '99999', category: 'VALIDATION' }],
    [
      { sourceCode: '13046', category: 'VALIDATION' },
      { sourceCode: '99999', category: 'VALIDATION' },
    ],
    [
      { sourceCode: '13046', category: 'VALIDATION' },
      { sourceCode: '1540', category: 'VALIDATION' },
    ],
  ] as const) {
    const result = classifyTravelportStaysReservationCreateOutcome({
      httpStatus: 400,
      body: errorResponse(errors),
      expectedReservation,
    });
    assert.equal(result.status, 'AMBIGUOUS');
    if (result.status === 'AMBIGUOUS') assert.equal(result.failureCode, 'INVALID_RESPONSE');
  }
});

test('review-required and Sync-required source codes never become definitive validation failures', () => {
  assert.equal(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 400,
    body: errorResponse([{ sourceCode: '13020', category: 'VALIDATION' }]),
    expectedReservation,
  }).status, 'REVIEW_REQUIRED');

  const syncRequired = classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 500,
    body: errorResponse([{ sourceCode: '13034', category: 'UNKNOWN' }]),
    expectedReservation,
  });
  assert.equal(syncRequired.status, 'AMBIGUOUS');
  if (syncRequired.status === 'AMBIGUOUS') assert.equal(syncRequired.failureCode, 'TRAVELPORT_SYNC_REQUIRED');
});
