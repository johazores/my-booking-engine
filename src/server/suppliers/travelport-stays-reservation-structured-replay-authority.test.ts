import assert from 'node:assert/strict';
import test from 'node:test';

import { createTravelportStaysReservationTraceAuthorityFetch } from './travelport-stays-reservation-trace-fetch.ts';

const traceId = '9f77a0b5-2614-4f6d-9053-f3a6175343f7';
const url = 'https://api.pp.travelport.net/11/hotel/book/reservations/build';
const init: RequestInit = {
  method: 'POST',
  headers: { E2ETrackingID: `sf-${traceId}` },
  body: '{}',
};

function wrap(response: Response) {
  return createTravelportStaysReservationTraceAuthorityFetch((async () => response) as typeof fetch);
}

test('replays an SF-owned serialization of the validated reservation body instead of provider raw JSON text', async () => {
  const providerBody = `{
    "ReservationResponse": {
      "traceId": "${traceId}",
      "marker": "first-provider-value",
      "marker": "accepted-provider-value"
    }
  }`;
  const response = await wrap(new Response(providerBody, {
    status: 200,
    headers: {
      traceId,
      'Content-Type': 'application/json',
    },
  }))(url, init);

  const replayBody = await response.text();
  const expectedBody = JSON.stringify(JSON.parse(providerBody));
  assert.equal(replayBody, expectedBody);
  assert.notEqual(replayBody, providerBody);
  assert.equal((replayBody.match(/"marker"/g) ?? []).length, 1);
  assert.equal(
    (JSON.parse(replayBody) as { ReservationResponse: { marker: string } }).ReservationResponse.marker,
    'accepted-provider-value',
  );
});

test('normalizes accepted structured JSON media types before exposing them downstream', async () => {
  for (const [providerContentType, expectedContentType] of [
    ['APPLICATION/JSON', 'application/json'],
    ['Application/JSON ; Charset="UTF-8"', 'application/json; charset=utf-8'],
  ] as const) {
    const response = await wrap(new Response(JSON.stringify({
      ReservationResponse: { traceId },
    }), {
      status: 200,
      headers: {
        traceId,
        'Content-Type': providerContentType,
      },
    }))(url, init);

    assert.equal(response.headers.get('Content-Type'), expectedContentType);
  }
});

test('uses the same structured replay boundary for trace-bound HTTP 500 application errors', async () => {
  const providerBody = `{
    "ErrorResponse": {
      "traceId": "${traceId}",
      "Result": {
        "@type": "Result",
        "Error": [{
          "@type": "ErrorDetail",
          "StatusCode": 500,
          "SourceCode": "13034",
          "category": "UNKNOWN",
          "SourceID": "API",
          "Message": "UNKNOWN ERROR RECEIVED FROM BOOKING.COM"
        }]
      }
    }
  }`;
  const response = await wrap(new Response(providerBody, {
    status: 500,
    headers: {
      traceId,
      'Content-Type': 'APPLICATION/JSON; CHARSET=UTF-8',
    },
  }))(url, init);

  assert.equal(response.status, 500);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(await response.text(), JSON.stringify(JSON.parse(providerBody)));
});
