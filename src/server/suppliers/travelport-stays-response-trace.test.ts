import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectTravelportStaysResponseTrace } from './travelport-stays-response-trace.ts';

const expected = '9f77a0b5-2614-4f6d-9053-f3a6175343f7';

function body(trace: unknown = expected, family: 'ReservationResponse' | 'ErrorResponse' = 'ReservationResponse') {
  return {
    [family]: {
      traceId: trace,
    },
  };
}

test('accepts the exact canonical response trace echo for reservation success and error families', () => {
  for (const family of ['ReservationResponse', 'ErrorResponse'] as const) {
    assert.deepEqual(inspectTravelportStaysResponseTrace({
      body: body(expected, family),
      expectedRequestCorrelationId: expected,
    }), {
      valid: true,
      providerCorrelationId: expected,
    });
  }
});

test('fails closed when the expected reservation response trace is missing, null, malformed, or mismatched', () => {
  for (const candidate of [
    { ReservationResponse: {} },
    body(null),
    body(''),
    body(` ${expected}`),
    body(`${expected}\n`),
    body('11111111-1111-4111-8111-111111111111'),
  ]) {
    assert.deepEqual(inspectTravelportStaysResponseTrace({
      body: candidate,
      expectedRequestCorrelationId: expected,
    }), {
      valid: false,
      providerCorrelationId: null,
    });
  }
});

test('rejects legacy-cased or competing response trace aliases', () => {
  for (const candidate of [
    { ReservationResponse: { traceID: expected } },
    { ReservationResponse: { traceId: expected, traceID: expected } },
  ]) {
    assert.equal(inspectTravelportStaysResponseTrace({
      body: candidate,
      expectedRequestCorrelationId: expected,
    }).valid, false);
  }
});

test('rejects ambiguous or malformed reservation response families before trace authority', () => {
  for (const candidate of [
    {},
    { ReservationResponse: {}, ErrorResponse: {} },
    { ReservationResponse: null },
    { ErrorResponse: null },
  ]) {
    assert.equal(inspectTravelportStaysResponseTrace({
      body: candidate,
      expectedRequestCorrelationId: expected,
    }).valid, false);
  }
});

test('without an expected request trace, bounded canonical provider correlation remains optional', () => {
  assert.deepEqual(inspectTravelportStaysResponseTrace({ body: { ReservationResponse: {} } }), {
    valid: true,
    providerCorrelationId: null,
  });
  assert.deepEqual(inspectTravelportStaysResponseTrace({ body: body('provider-trace') }), {
    valid: true,
    providerCorrelationId: 'provider-trace',
  });
  assert.equal(inspectTravelportStaysResponseTrace({ body: body(null) }).valid, false);
});

test('rejects every ASCII control family from provider correlation evidence', () => {
  for (const traceId of [
    'provider\u0000trace',
    'provider\ttrace',
    'provider\u001ftrace',
    'provider\u007ftrace',
  ]) {
    assert.deepEqual(inspectTravelportStaysResponseTrace({ body: body(traceId) }), {
      valid: false,
      providerCorrelationId: null,
    });
  }
});
