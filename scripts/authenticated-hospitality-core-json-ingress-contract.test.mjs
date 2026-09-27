import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const policy = read('src/server/bookings/hospitality-booking-http.ts');
const boundedRoutes = [
  'app/api/bookings/hospitality/search/route.ts',
  'app/api/bookings/hospitality/availability/route.ts',
  'app/api/bookings/hospitality/quote/route.ts',
  'app/api/bookings/hospitality/holds/route.ts',
  'app/api/bookings/hospitality/confirm/route.ts',
  'app/api/bookings/hospitality/[booking-id]/reschedule/route.ts',
  'app/api/bookings/hospitality/[booking-id]/guests/route.ts',
  'app/api/bookings/hospitality/[booking-id]/modify/route.ts',
  'app/api/bookings/hospitality/[booking-id]/modify/preview/route.ts',
  'app/api/bookings/hospitality/[booking-id]/tax-invoices/route.ts',
  'app/api/bookings/hospitality/[booking-id]/commercial-amendments/route.ts',
  'app/api/bookings/hospitality/[booking-id]/adjustment-notes/route.ts',
  'app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/adjustment-note/route.ts',
];

test('authenticated hospitality JSON ingress uses the shared bounded parser', () => {
  assert.match(policy, /HOSPITALITY_BOOKING_REQUEST_MAX_BYTES = 64 \* 1024/);
  assert.match(policy, /request\.body\.getReader\(\)/);
  assert.match(policy, /TextDecoder\('utf-8', \{ fatal: true \}\)/);
  assert.match(policy, /JSON\.parse\(rawBody\)/);
  assert.doesNotMatch(policy, /request\.json\(\)/);

  for (const path of boundedRoutes) {
    const source = read(path);
    assert.match(source, /readHospitalityBookingJsonObject\(request\)/, `${path} must use the bounded parser`);
    assert.doesNotMatch(source, /request\.json\(\)/, `${path} must not bypass the bounded parser`);
  }
});
