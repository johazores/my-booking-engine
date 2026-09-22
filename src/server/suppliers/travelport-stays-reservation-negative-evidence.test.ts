import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectTravelportStaysReservationNegativeEvidence } from './travelport-stays-reservation-negative-evidence.ts';

function negativePayload(overrides: Record<string, unknown> = {}) {
  return {
    ErrorResponse: {
      traceId: 'trace-not-found',
      Result: {
        '@type': 'Result',
        Error: [{
          '@type': 'ErrorDetail',
          StatusCode: 400,
          Message: 'RESERVATION WAS NOT FOUND IN SUPPLIER SYSTEM',
          category: 'VALIDATION',
          SourceID: 'API',
          SourceCode: '13061',
          ...overrides,
        }],
      },
    },
  };
}

test('accepts only the documented Travelport Stays 13061 exact-reservation negative evidence', () => {
  assert.deepEqual(inspectTravelportStaysReservationNegativeEvidence(negativePayload(), 400), {
    status: 'NOT_FOUND',
    providerCorrelationId: 'trace-not-found',
  });
  assert.deepEqual(
    inspectTravelportStaysReservationNegativeEvidence(negativePayload({ SourceCode: 13061 }), 400),
    { status: 'NOT_FOUND', providerCorrelationId: 'trace-not-found' },
  );
});

test('generic HTTP status and malformed or contradictory provider errors never become negative authority', () => {
  const cases: Array<[unknown, number]> = [
    [{}, 404],
    [negativePayload(), 404],
    [negativePayload({ SourceCode: '13060' }), 400],
    [negativePayload({ StatusCode: 404 }), 400],
    [negativePayload({ category: 'UNKNOWN' }), 400],
    [negativePayload({ '@type': 'Error' }), 400],
    [negativePayload({ SourceID: '' }), 400],
    [negativePayload({ Message: 'bad\nmessage' }), 400],
    [{ ...negativePayload(), ReservationResponse: null }, 400],
    [{ ErrorResponse: { Result: { '@type': 'Result', Error: [] } } }, 400],
    [{ ErrorResponse: { Result: { '@type': 'Result', Error: [negativePayload().ErrorResponse.Result.Error[0], negativePayload().ErrorResponse.Result.Error[0]] } } }, 400],
  ];

  for (const [payload, status] of cases) {
    assert.equal(inspectTravelportStaysReservationNegativeEvidence(payload, status), null);
  }
});
