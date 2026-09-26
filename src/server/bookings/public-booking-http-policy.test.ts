import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PUBLIC_BOOKING_REQUEST_MAX_BYTES,
  isSameOriginPublicBookingWrite,
  readPublicBookingJsonObject,
} from './public-booking-http-policy.ts';

test('accepts a matching origin', () => {
  const request = new Request('https://booking.example.com/api/public-bookings/acme/hospitality/holds', {
    method: 'POST',
    headers: { origin: 'https://booking.example.com' },
  });
  assert.equal(isSameOriginPublicBookingWrite(request), true);
});

test('rejects missing, cross-origin, and malformed origins', () => {
  assert.equal(isSameOriginPublicBookingWrite(new Request('https://booking.example.com/api')), false);
  assert.equal(isSameOriginPublicBookingWrite(new Request('https://booking.example.com/api', {
    headers: { origin: 'https://attacker.example.com' },
  })), false);
  assert.equal(isSameOriginPublicBookingWrite(new Request('https://booking.example.com/api', {
    headers: { origin: 'not a url' },
  })), false);
});

function jsonRequest(body: BodyInit, headers?: Record<string, string>) {
  return new Request('https://booking.example.com/api/public-bookings/acme/hospitality/holds', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body,
  });
}

test('reads only JSON object bodies', async () => {
  assert.deepEqual(await readPublicBookingJsonObject(jsonRequest('{"value":1}')), { value: 1 });
  assert.equal(await readPublicBookingJsonObject(jsonRequest('null')), null);
  assert.equal(await readPublicBookingJsonObject(jsonRequest('[]')), null);
  assert.equal(await readPublicBookingJsonObject(jsonRequest('{')), null);
  assert.equal(await readPublicBookingJsonObject(new Request('https://booking.example.com/api', {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
  })), null);
});

test('rejects invalid and oversized advertised content lengths', async () => {
  assert.equal(await readPublicBookingJsonObject(jsonRequest('{}', { 'content-length': 'nope' })), null);
  assert.equal(await readPublicBookingJsonObject(jsonRequest('{}', {
    'content-length': String(PUBLIC_BOOKING_REQUEST_MAX_BYTES + 1),
  })), null);
});

test('rejects streamed bodies above the public booking ceiling', async () => {
  const body = JSON.stringify({ value: 'x'.repeat(PUBLIC_BOOKING_REQUEST_MAX_BYTES) });
  assert.ok(Buffer.byteLength(body, 'utf8') > PUBLIC_BOOKING_REQUEST_MAX_BYTES);
  assert.equal(await readPublicBookingJsonObject(jsonRequest(body)), null);
});

test('rejects invalid UTF-8 before JSON parsing', async () => {
  const invalidUtf8 = new Uint8Array([123, 34, 118, 97, 108, 117, 101, 34, 58, 34, 255, 34, 125]);
  assert.equal(await readPublicBookingJsonObject(jsonRequest(invalidUtf8)), null);
});

test('supports a smaller caller-specific byte ceiling', async () => {
  assert.deepEqual(await readPublicBookingJsonObject(jsonRequest('{"value":1}'), 32), { value: 1 });
  assert.equal(await readPublicBookingJsonObject(jsonRequest('{"value":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}'), 32), null);
});
