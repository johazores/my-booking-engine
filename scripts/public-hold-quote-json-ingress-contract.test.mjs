import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const policy = read('src/server/bookings/public-booking-http-policy.ts');
const publicRoutes = [
  'app/api/public-bookings/[organization-slug]/hospitality/holds/route.ts',
  'app/api/public-bookings/[organization-slug]/hospitality/quote/route.ts',
];

test('public hold and quote JSON ingress uses the shared bounded parser', () => {
  assert.match(policy, /PUBLIC_BOOKING_REQUEST_MAX_BYTES = 64 \* 1024/);
  assert.match(policy, /request\.body\.getReader\(\)/);
  assert.match(policy, /TextDecoder\('utf-8', \{ fatal: true \}\)/);
  assert.match(policy, /JSON\.parse\(rawBody\)/);
  assert.doesNotMatch(policy, /request\.json\(\)/);

  for (const path of publicRoutes) {
    const source = read(path);
    assert.match(source, /readPublicBookingJsonObject\(request\)/);
    assert.doesNotMatch(source, /request\.json\(\)/);
    assert.match(source, /invalid-request/);
  }
});
