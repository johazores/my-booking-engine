import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTravelportStaysOperationalLogFetch,
  type StructuredTravelportStaysProviderRequestLogRecord,
} from './travelport-stays-operational-log-fetch.ts';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const INTEGRATION_ID = '22222222-2222-4222-8222-222222222222';
const TRACE_ID = '123e4567-e89b-42d3-a456-426614174000';
const FALLBACK_REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const CONTEXT = Object.freeze({
  organizationId: ORGANIZATION_ID,
  integrationId: INTEGRATION_ID,
  credentialVersion: 7,
  environment: 'production' as const,
});

function deterministicClock() {
  const values = [1_000, 1_025];
  return () => values.shift() ?? 1_025;
}

test('logs safe structured Travelport request context without request secrets or resource identifiers', async () => {
  const records: StructuredTravelportStaysProviderRequestLogRecord[] = [];
  const fetchImpl = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  const operationalFetch = createTravelportStaysOperationalLogFetch({
    ...CONTEXT,
    fetchImpl,
    sink: (record) => records.push(record),
    now: () => new Date('2026-09-14T02:00:00.000Z'),
    nowMs: deterministicClock(),
    randomUuid: () => FALLBACK_REQUEST_ID,
  });

  await operationalFetch('https://api.travelport.net/11/hotel/book/reservations/', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer provider-secret-token',
      E2ETrackingID: `sf-${TRACE_ID}`,
      TraceId: TRACE_ID,
      XAUTH_TRAVELPORT_ACCESSGROUP: 'private-access-group',
      'Content-Type': 'application/json',
    },
    body: '{"traveler":{"name":"Sensitive Guest"},"locator":"PRIVATE-LOCATOR"}',
  });

  assert.deepEqual(records, [{
    timestamp: '2026-09-14T02:00:00.000Z',
    level: 'info',
    event: 'supplier.provider-request.completed',
    requestCorrelationId: TRACE_ID,
    providerCorrelationId: TRACE_ID,
    organizationId: ORGANIZATION_ID,
    integrationId: INTEGRATION_ID,
    credentialVersion: 7,
    provider: 'travelport-stays',
    environment: 'production',
    operation: 'reservation.sync',
    outcome: 'succeeded',
    statusCode: 200,
    durationMs: 25,
    failureClass: null,
  }]);

  const serialized = JSON.stringify(records[0]);
  for (const forbidden of [
    'provider-secret-token',
    'private-access-group',
    'Sensitive Guest',
    'PRIVATE-LOCATOR',
    '/11/hotel/book/reservations/',
    'E2ETrackingID',
    'Authorization',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('classifies all implemented Travelport operations without logging opaque pagination or locator segments', async () => {
  const records: StructuredTravelportStaysProviderRequestLogRecord[] = [];
  const fetchImpl = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  const operationalFetch = createTravelportStaysOperationalLogFetch({
    ...CONTEXT,
    fetchImpl,
    sink: (record) => records.push(record),
    randomUuid: () => FALLBACK_REQUEST_ID,
  });

  const cases = [
    ['POST', 'https://auth.travelport.net/oauth/token', 'oauth.token'],
    ['POST', 'https://api.travelport.net/12/hotel/search/searchcomplete', 'search.complete'],
    ['GET', 'https://api.travelport.net/12/hotel/search/searchcomplete/OPAQUE-TOKEN?pageNumber=2', 'search.page'],
    ['POST', 'https://api.travelport.net/11/hotel/rules/offershospitality/buildfromrequest', 'rules'],
    ['POST', 'https://api.travelport.net/11/hotel/availability/catalogofferingshospitality', 'availability'],
    ['GET', 'https://api.travelport.net/11/hotel/availability/catalogofferingshospitality/OPAQUE-TOKEN?pageNumber=3', 'availability.page'],
    ['POST', 'https://api.travelport.net/11/hotel/book/reservations/build', 'reservation.create'],
    ['POST', 'https://api.travelport.net/11/hotel/book/reservations/', 'reservation.sync'],
    ['GET', 'https://api.travelport.net/11/hotel/book/reservations/PRIVATE-LOCATOR', 'reservation.retrieve'],
  ] as const;

  for (const [method, url] of cases) {
    await operationalFetch(url, { method });
  }

  assert.deepEqual(records.map((record) => record.operation), cases.map((entry) => entry[2]));
  assert.equal(records[0]?.requestCorrelationId, FALLBACK_REQUEST_ID);
  assert.equal(records[0]?.providerCorrelationId, null);
  const serialized = JSON.stringify(records);
  assert.equal(serialized.includes('OPAQUE-TOKEN'), false);
  assert.equal(serialized.includes('PRIVATE-LOCATOR'), false);
});

test('records HTTP and transport failures without serializing provider error content', async () => {
  const records: StructuredTravelportStaysProviderRequestLogRecord[] = [];
  let attempt = 0;
  const fetchImpl = (async () => {
    attempt += 1;
    if (attempt === 1) return new Response('provider detail must not be logged', { status: 503 });
    throw new Error('network error containing provider-secret-token');
  }) as typeof fetch;
  const operationalFetch = createTravelportStaysOperationalLogFetch({
    ...CONTEXT,
    fetchImpl,
    sink: (record) => records.push(record),
    randomUuid: () => FALLBACK_REQUEST_ID,
  });

  const response = await operationalFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
  });
  assert.equal(response.status, 503);

  await assert.rejects(
    operationalFetch('https://api.travelport.net/12/hotel/search/searchcomplete', { method: 'POST' }),
    /network error/,
  );

  assert.equal(records.length, 2);
  assert.equal(records[0]?.level, 'error');
  assert.equal(records[0]?.outcome, 'failed');
  assert.equal(records[0]?.statusCode, 503);
  assert.equal(records[1]?.level, 'error');
  assert.equal(records[1]?.outcome, 'failed');
  assert.equal(records[1]?.statusCode, null);
  assert.equal(records[1]?.failureClass, 'transport');

  const serialized = JSON.stringify(records);
  assert.equal(serialized.includes('provider detail must not be logged'), false);
  assert.equal(serialized.includes('provider-secret-token'), false);
});

test('classifies rejected and aborted calls and never lets the log sink break supplier I/O', async () => {
  const rejectedRecords: StructuredTravelportStaysProviderRequestLogRecord[] = [];
  const rejectedFetch = createTravelportStaysOperationalLogFetch({
    ...CONTEXT,
    fetchImpl: (async () => new Response(null, { status: 429 })) as typeof fetch,
    sink: (record) => rejectedRecords.push(record),
    randomUuid: () => FALLBACK_REQUEST_ID,
  });
  await rejectedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', { method: 'POST' });
  assert.equal(rejectedRecords[0]?.level, 'warn');
  assert.equal(rejectedRecords[0]?.outcome, 'rejected');
  assert.equal(rejectedRecords[0]?.statusCode, 429);

  const controller = new AbortController();
  controller.abort();
  const abortedRecords: StructuredTravelportStaysProviderRequestLogRecord[] = [];
  const abortedFetch = createTravelportStaysOperationalLogFetch({
    ...CONTEXT,
    fetchImpl: (async () => {
      throw new DOMException('aborted request detail', 'AbortError');
    }) as typeof fetch,
    sink: (record) => abortedRecords.push(record),
    randomUuid: () => FALLBACK_REQUEST_ID,
  });

  await assert.rejects(
    abortedFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
      method: 'POST',
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.equal(abortedRecords[0]?.level, 'warn');
  assert.equal(abortedRecords[0]?.failureClass, 'aborted');
  assert.equal(JSON.stringify(abortedRecords).includes('aborted request detail'), false);

  const successfulFetch = createTravelportStaysOperationalLogFetch({
    ...CONTEXT,
    fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    sink: () => {
      throw new Error('logging backend unavailable');
    },
    randomUuid: () => FALLBACK_REQUEST_ID,
  });

  const response = await successfulFetch('https://api.travelport.net/12/hotel/search/searchcomplete', {
    method: 'POST',
  });
  assert.equal(response.status, 200);
});

test('fails closed to safe identifier placeholders inside log records without affecting transport', async () => {
  const records: StructuredTravelportStaysProviderRequestLogRecord[] = [];
  const operationalFetch = createTravelportStaysOperationalLogFetch({
    organizationId: 'not a tenant id',
    integrationId: 'not an integration id',
    credentialVersion: -5,
    environment: 'pre-production',
    fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    sink: (record) => records.push(record),
    randomUuid: () => 'not-a-request-id',
  });

  await operationalFetch('https://auth.pp.travelport.net/oauth/token', { method: 'POST' });

  assert.equal(records[0]?.organizationId, 'invalid-organization-id');
  assert.equal(records[0]?.integrationId, 'invalid-integration-id');
  assert.equal(records[0]?.credentialVersion, 0);
  assert.equal(records[0]?.requestCorrelationId, 'invalid-request-correlation-id');
  assert.equal(records[0]?.providerCorrelationId, null);
});

test('keeps observation metadata failures out of the supplier request authority path', async () => {
  const records: StructuredTravelportStaysProviderRequestLogRecord[] = [];
  const operationalFetch = createTravelportStaysOperationalLogFetch({
    ...CONTEXT,
    fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    sink: (record) => records.push(record),
    now: () => {
      throw new Error('clock unavailable');
    },
    nowMs: () => {
      throw new Error('timer unavailable');
    },
    randomUuid: () => {
      throw new Error('uuid unavailable');
    },
  });

  const response = await operationalFetch('https://auth.travelport.net/oauth/token', { method: 'POST' });

  assert.equal(response.status, 200);
  assert.equal(records[0]?.timestamp, '1970-01-01T00:00:00.000Z');
  assert.equal(records[0]?.durationMs, 0);
  assert.equal(records[0]?.requestCorrelationId, 'invalid-request-correlation-id');
});


test('pins tenant integration attribution at construction despite later caller mutation', async () => {
  const records: StructuredTravelportStaysProviderRequestLogRecord[] = [];
  const mutable = {
    organizationId: CONTEXT.organizationId as string,
    integrationId: CONTEXT.integrationId as string,
    credentialVersion: CONTEXT.credentialVersion as number,
    environment: 'production' as 'production' | 'pre-production',
    fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    sink: (record: StructuredTravelportStaysProviderRequestLogRecord) => records.push(record),
    randomUuid: () => FALLBACK_REQUEST_ID,
  };
  // Pass the same mutable object, not a spread clone, to exercise the
  // long-lived constructor authority rather than a test-only copy.
  const operationalFetch = createTravelportStaysOperationalLogFetch(mutable);
  mutable.organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  mutable.integrationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  mutable.credentialVersion = 99;
  mutable.environment = 'pre-production';
  await operationalFetch('https://api.travelport.net/12/hotel/search/searchcomplete', { method: 'POST' });
  assert.equal(records[0]?.organizationId, ORGANIZATION_ID);
  assert.equal(records[0]?.integrationId, INTEGRATION_ID);
  assert.equal(records[0]?.credentialVersion, 7);
  assert.equal(records[0]?.environment, 'production');
});

test('reads tenant attribution getters once before provider I/O', async () => {
  const counts = new Map<string, number>();
  const options = Object.fromEntries(Object.entries(CONTEXT).map(([key, value]) => [
    key, value,
  ])) as Record<string, unknown>;
  for (const [key, value] of Object.entries(CONTEXT)) {
    Object.defineProperty(options, key, {
      enumerable: true,
      get() {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        if (count > 1) throw new Error('tenant attribution reread');
        return value;
      },
    });
  }
  const records: StructuredTravelportStaysProviderRequestLogRecord[] = [];
  Object.defineProperties(options, {
    fetchImpl: { value: (async () => new Response('{}', { status: 200 })) as typeof fetch },
    sink: { value: (record: StructuredTravelportStaysProviderRequestLogRecord) => records.push(record) },
    randomUuid: { value: () => FALLBACK_REQUEST_ID },
  });
  const operationalFetch = createTravelportStaysOperationalLogFetch(options as never);
  await operationalFetch('https://api.travelport.net/12/hotel/search/searchcomplete', { method: 'POST' });
  await operationalFetch('https://api.travelport.net/12/hotel/search/searchcomplete', { method: 'POST' });
  assert.equal(records.length, 2);
  for (const count of counts.values()) assert.equal(count, 1);
});

test('diagnostic request metadata getters fail open without leaking details or blocking provider I/O', async () => {
  const records: StructuredTravelportStaysProviderRequestLogRecord[] = [];
  let calls = 0;
  const wrapped = createTravelportStaysOperationalLogFetch({
    ...CONTEXT,
    fetchImpl: (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
    sink: (record) => records.push(record),
    randomUuid: () => FALLBACK_REQUEST_ID,
  });
  for (const key of ['method', 'headers', 'signal'] as const) {
    const init: RequestInit = {};
    Object.defineProperty(init, key, { get() { throw new Error('private secret'); } });
    await wrapped('https://api.travelport.net/12/hotel/search/searchcomplete', init);
  }
  assert.equal(calls, 3);
  assert.equal(records.length, 3);
  assert.ok(records.every((record) => record.outcome === 'succeeded'));
  assert.equal(records[0]?.operation, 'unknown');
  assert.equal(JSON.stringify(records).includes('private secret'), false);
});

test('diagnostic abort-state getter failure cannot mask the provider transport error', async () => {
  const records: StructuredTravelportStaysProviderRequestLogRecord[] = [];
  const wrapped = createTravelportStaysOperationalLogFetch({
    ...CONTEXT,
    fetchImpl: (async () => { throw new Error('original provider failure'); }) as typeof fetch,
    sink: (record) => records.push(record),
    randomUuid: () => FALLBACK_REQUEST_ID,
  });
  const signal = { get aborted() { throw new Error('private secret'); } } as AbortSignal;
  await assert.rejects(
    wrapped('https://api.travelport.net/12/hotel/search/searchcomplete', { method: 'POST', signal }),
    /original provider failure/,
  );
  assert.equal(records[0]?.failureClass, 'transport');
  assert.equal(JSON.stringify(records).includes('private secret'), false);
});
