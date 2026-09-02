import assert from 'node:assert/strict';
import test from 'node:test';

import { isSameOriginPublicBookingWrite } from './public-booking-http-policy.ts';

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
