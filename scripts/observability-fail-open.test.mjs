import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { REQUEST_ID_HEADER } from '../src/lib/request-correlation.ts';
import {
  buildStructuredRequestLogRecord,
  createRequestObservation,
  resolveRequestId,
} from '../src/server/observability/request-observability.ts';
import { createHospitalitySupplierReservationProviderObservation } from '../src/server/suppliers/hospitality-supplier-reservation-observability.ts';
import { createTravelportStaysOperationalLogFetch } from '../src/server/suppliers/travelport-stays-operational-log-fetch.ts';
import { createTravelportStaysReservationCreateProviderObservation } from '../src/server/suppliers/travelport-stays-reservation-create-observability.ts';
import { createTravelportStaysReservationSyncProviderObservation } from '../src/server/suppliers/travelport-stays-reservation-sync-observability.ts';

const REQUEST_ID = 'sf-request.2026-09-14:fail-open';
const ATTEMPT_ID = '123e4567-e89b-42d3-a456-426614174000';
const ORGANIZATION_ID = '223e4567-e89b-42d3-a456-426614174000';

function throws(message) {
  throw new Error(message);
}

test('request ID generation failure degrades to a bounded sentinel instead of failing the request', () => {
  const request = new Request('https://sf.example.test');
  assert.equal(resolveRequestId(request, () => throws('uuid unavailable')), 'request-id-unavailable');
  assert.equal(resolveRequestId(request, () => 'unsafe generated request id'), 'request-id-unavailable');
});

test('request record timestamp and duration fail closed to non-sensitive safe values', () => {
  const record = buildStructuredRequestLogRecord({
    requestId: REQUEST_ID,
    operation: 'booking.hospitality-confirmation.create',
    statusCode: 201,
    durationMs: Number.POSITIVE_INFINITY,
    now: () => throws('clock unavailable'),
  });
  assert.equal(record.timestamp, '1970-01-01T00:00:00.000Z');
  assert.equal(record.durationMs, 0);
});

test('request observation returns the application response when clock, sink, or response-header mutation is unavailable', () => {
  let clockCalls = 0;
  const request = new Request('https://sf.example.test', { headers: { [REQUEST_ID_HEADER]: REQUEST_ID } });
  const observation = createRequestObservation(request, { operation: 'payment.stripe.reconcile' }, {
    nowMs: () => {
      clockCalls += 1;
      if (clockCalls === 1) return Number.NaN;
      return throws('timer unavailable');
    },
    now: () => throws('timestamp unavailable'),
    sink: () => throws('log sink unavailable'),
  });
  const response = new Response('{}', { status: 200 });
  response.headers.set = () => throws('headers unavailable');
  const returned = observation.finish(response, { organizationId: ORGANIZATION_ID, provider: 'stripe' });
  assert.equal(returned, response);
  assert.equal(returned.status, 200);
});

test('supplier recovery observation is one-shot and fail-open when observability dependencies fail', () => {
  const observation = createHospitalitySupplierReservationProviderObservation({
    requestCorrelationId: ATTEMPT_ID,
    organizationId: ORGANIZATION_ID,
    provider: 'travelport-stays',
    nowMs: () => throws('timer unavailable'),
    now: () => throws('timestamp unavailable'),
    sink: () => throws('sink unavailable'),
  });
  const first = observation.finish({ status: 'FAILED', failureCode: 'TIMEOUT' });
  const second = observation.finish({ status: 'SUCCEEDED', providerResult: 'FOUND' });
  assert.equal(first?.timestamp, '1970-01-01T00:00:00.000Z');
  assert.equal(first?.durationMs, 0);
  assert.equal(first?.outcome, 'failed');
  assert.equal(second, null);
});

test('Travelport create and sync observations cannot interrupt provider settlement when logging fails', () => {
  const create = createTravelportStaysReservationCreateProviderObservation({
    requestCorrelationId: ATTEMPT_ID,
    organizationId: ORGANIZATION_ID,
    nowMs: () => throws('timer unavailable'),
    now: () => throws('timestamp unavailable'),
    sink: () => throws('sink unavailable'),
  });
  const createRecord = create.finish('CONFIRMED');
  assert.equal(createRecord?.timestamp, '1970-01-01T00:00:00.000Z');
  assert.equal(createRecord?.durationMs, 0);
  assert.equal(createRecord?.outcome, 'confirmed');

  const sync = createTravelportStaysReservationSyncProviderObservation({
    requestCorrelationId: ATTEMPT_ID,
    organizationId: ORGANIZATION_ID,
    nowMs: () => Number.POSITIVE_INFINITY,
    now: () => new Date(Number.NaN),
    sink: () => throws('sink unavailable'),
  });
  const syncRecord = sync.finish('CONFIRMED');
  assert.equal(syncRecord?.timestamp, '1970-01-01T00:00:00.000Z');
  assert.equal(syncRecord?.durationMs, 0);
  assert.equal(syncRecord?.outcome, 'confirmed');
});

test('Travelport terminal request timing also degrades to zero when the start clock is unavailable', async () => {
  const records = [];
  let clockCalls = 0;
  const operationalFetch = createTravelportStaysOperationalLogFetch({
    organizationId: ORGANIZATION_ID,
    integrationId: '323e4567-e89b-42d3-a456-426614174000',
    credentialVersion: 3,
    environment: 'production',
    fetchImpl: async () => new Response('{}', { status: 200 }),
    nowMs: () => {
      clockCalls += 1;
      return clockCalls === 1 ? Number.NaN : 5_000;
    },
    sink: (record) => records.push(record),
  });

  await operationalFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
    headers: { TraceId: ATTEMPT_ID },
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].durationMs, 0);
});

test('all current application and supplier domain observers use the shared fail-open emission boundary', () => {
  for (const path of [
    '../src/server/observability/request-observability.ts',
    '../src/server/suppliers/hospitality-supplier-reservation-observability.ts',
    '../src/server/suppliers/travelport-stays-operational-log-fetch.ts',
    '../src/server/suppliers/travelport-stays-reservation-create-observability.ts',
    '../src/server/suppliers/travelport-stays-reservation-sync-observability.ts',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /emitStructuredObservationSafely/);
    assert.match(source, /safeObservationDurationMs/);
    assert.match(source, /safeObservationTimestamp/);
  }

  const safety = readFileSync(new URL('../src/server/observability/structured-log-safety.ts', import.meta.url), 'utf8');
  assert.match(safety, /try \{/);
  assert.match(safety, /catch \{/);
  assert.match(safety, /Observability availability must never become application or provider-request authority/);
});
