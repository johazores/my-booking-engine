import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boundedTravelportStaysReservationRetryAfter,
  createTravelportStaysReservationStatusOnlyResponseFetch,
} from './travelport-stays-reservation-status-only-response-fetch.ts';

const TRACE_ID = '9f77a0b5-2614-4f6d-9053-f3a6175343f7';
const RESERVATION_URL = 'https://api.pp.travelport.net/11/hotel/book/reservations/build';
const SEARCH_URL = 'https://api.pp.travelport.net/12/hotel/search/searchcomplete';

function requestInit(): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      E2ETrackingID: `sf-${TRACE_ID}`,
    },
    body: '{}',
  };
}

function providerResponse(status: number, retryAfter = '7') {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"provider":"untrusted"}'));
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = new Response(body, {
    status,
    statusText: 'provider-owned detail',
    headers: {
      'Content-Length': 'not-a-number',
      'Content-Type': 'text/html',
      'Retry-After': retryAfter,
      'X-Provider-Correlation': 'provider-owned-correlation',
    },
  });
  return { response, cancelled: () => cancelled };
}

test('reservation status-only responses are bodyless and metadata-minimized before replay buffering', async () => {
  for (const status of [401, 403, 429, 503]) {
    const fixture = providerResponse(status);
    const wrapped = createTravelportStaysReservationStatusOnlyResponseFetch(
      (async () => fixture.response) as typeof fetch,
    );
    const response = await wrapped(RESERVATION_URL, requestInit());
    await Promise.resolve();

    assert.equal(response.status, status);
    assert.equal(response.statusText, '');
    assert.deepEqual([...response.headers.entries()], [['retry-after', '7']]);
    assert.equal(await response.text(), '');
    assert.equal(fixture.cancelled(), true);
  }
});

test('HTTP 500 stays structured and is not consumed by the status-only boundary', async () => {
  const fixture = providerResponse(500);
  const wrapped = createTravelportStaysReservationStatusOnlyResponseFetch(
    (async () => fixture.response) as typeof fetch,
  );
  const response = await wrapped(RESERVATION_URL, requestInit());

  assert.equal(response, fixture.response);
  assert.equal(response.statusText, 'provider-owned detail');
  assert.equal(response.headers.get('Content-Length'), 'not-a-number');
  assert.equal(fixture.cancelled(), false);
});

test('non-reservation and reservation-prefix-lookalike responses are left to the shared transport response policy', async () => {
  for (const url of [
    SEARCH_URL,
    'https://api.pp.travelport.net/11/hotel/book/reservations-legacy',
  ]) {
    const fixture = providerResponse(503);
    const wrapped = createTravelportStaysReservationStatusOnlyResponseFetch(
      (async () => fixture.response) as typeof fetch,
    );
    const response = await wrapped(url, requestInit());

    assert.equal(response, fixture.response);
    assert.equal(response.headers.get('Content-Type'), 'text/html');
    assert.equal(fixture.cancelled(), false);
  }
});

test('Retry-After authority accepts only bounded canonical delay or IMF-fixdate values', () => {
  for (const value of ['0', '7', '4294967295', 'Sun, 13 Sep 2026 03:45:00 GMT']) {
    assert.equal(boundedTravelportStaysReservationRetryAfter(value), value);
  }
  for (const value of [null, '', ' 7', '+7', '7.5', 'Sun, 13-Sep-26 03:45:00 GMT', 'bad-date', 'x'.repeat(257)]) {
    assert.equal(boundedTravelportStaysReservationRetryAfter(value), null);
  }
});
