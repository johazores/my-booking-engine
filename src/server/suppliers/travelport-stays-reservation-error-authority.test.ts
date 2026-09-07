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

function classify(errors: readonly unknown[]) {
  return classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 500,
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

test('13034 requires a structurally valid homogeneous Sync-required error family', () => {
  assert.deepEqual(classify([{ SourceCode: '13034', category: 'UNKNOWN' }]), {
    status: 'AMBIGUOUS',
    failureCode: 'TRAVELPORT_SYNC_REQUIRED',
    supplierConfirmationReference: null,
    providerCorrelationId: '4807ae55-722d-4935-93a9-e9f743625bf5',
  });

  // Legacy category-less envelopes retain the existing conservative Sync-required
  // classification, but malformed, contradictory, or mixed evidence does not.
  assert.equal(classify([{ SourceCode: '13034' }]).failureCode, 'TRAVELPORT_SYNC_REQUIRED');
  assertInvalid(classify([{ SourceCode: '13034', category: 'VALIDATION' }]));
  assertInvalid(classify([
    { SourceCode: '13034', category: 'UNKNOWN' },
    { SourceCode: '13020', category: 'VALIDATION' },
  ]));
  assertInvalid(classify([
    { SourceCode: '13034', category: 'UNKNOWN' },
    { Message: 'missing source code' },
  ]));
});

test('price and guarantee review decisions reject explicit contradictory categories and mixed families', () => {
  assert.deepEqual(classify([{ SourceCode: '13020', category: 'VALIDATION' }]), {
    status: 'REVIEW_REQUIRED',
    reason: 'PRICE_CHANGED',
    providerCorrelationId: '4807ae55-722d-4935-93a9-e9f743625bf5',
  });
  assert.deepEqual(classify([{ SourceCode: '13017', category: 'VALIDATION' }]), {
    status: 'REVIEW_REQUIRED',
    reason: 'GUARANTEE_CHANGED',
    providerCorrelationId: '4807ae55-722d-4935-93a9-e9f743625bf5',
  });

  assertInvalid(classify([{ SourceCode: '13020', category: 'UNKNOWN' }]));
  assertInvalid(classify([{ SourceCode: '13017', category: 'RETRY' }]));
  assertInvalid(classify([
    { SourceCode: '13020', category: 'VALIDATION' },
    { SourceCode: '99999', category: 'VALIDATION' },
  ]));
});
