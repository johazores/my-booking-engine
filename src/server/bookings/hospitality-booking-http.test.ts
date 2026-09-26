import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BookingApiPayloadError,
  HOSPITALITY_BOOKING_REQUEST_MAX_BYTES,
  readHospitalityBookingJsonObject,
} from './hospitality-booking-http.ts';

function jsonRequest(body: BodyInit, headers?: Record<string, string>) {
  return new Request('https://booking.example.com/api/bookings/hospitality/holds', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body,
  });
}

async function rejectsPayload(request: Request, maxBytes?: number) {
  await assert.rejects(
    () => readHospitalityBookingJsonObject(request, maxBytes),
    (error: unknown) => error instanceof BookingApiPayloadError,
  );
}

test('reads only JSON object bodies', async () => {
  assert.deepEqual(await readHospitalityBookingJsonObject(jsonRequest('{"value":1}')), { value: 1 });
  await rejectsPayload(jsonRequest('null'));
  await rejectsPayload(jsonRequest('[]'));
  await rejectsPayload(jsonRequest('{'));
  await rejectsPayload(new Request('https://booking.example.com/api', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  }));
});

test('rejects invalid and oversized advertised content lengths', async () => {
  await rejectsPayload(jsonRequest('{}', { 'content-length': 'nope' }));
  await rejectsPayload(jsonRequest('{}', {
    'content-length': String(HOSPITALITY_BOOKING_REQUEST_MAX_BYTES + 1),
  }));
});

test('rejects streamed bodies above the authenticated booking ceiling', async () => {
  const body = JSON.stringify({ value: 'x'.repeat(HOSPITALITY_BOOKING_REQUEST_MAX_BYTES) });
  assert.ok(Buffer.byteLength(body, 'utf8') > HOSPITALITY_BOOKING_REQUEST_MAX_BYTES);
  await rejectsPayload(jsonRequest(body));
});

test('rejects invalid UTF-8 before JSON parsing', async () => {
  const invalidUtf8 = new Uint8Array([123, 34, 118, 97, 108, 117, 101, 34, 58, 34, 255, 34, 125]);
  await rejectsPayload(jsonRequest(invalidUtf8));
});

test('supports a smaller caller-specific byte ceiling', async () => {
  assert.deepEqual(await readHospitalityBookingJsonObject(jsonRequest('{"value":1}'), 32), { value: 1 });
  await rejectsPayload(jsonRequest('{"value":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}'), 32);
});
