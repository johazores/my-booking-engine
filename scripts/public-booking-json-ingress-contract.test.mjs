import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const policy = read('src/server/bookings/public-booking-http-policy.ts');
const publicRoutes = [
  'app/api/public-bookings/[organization-slug]/hospitality/holds/route.ts',
  'app/api/public-bookings/[organization-slug]/hospitality/quote/route.ts',
  'app/api/public-bookings/[organization-slug]/hospitality/confirmation/route.ts',
  'app/api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout/route.ts',
  'app/api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout/status/route.ts',
];

test('public booking JSON ingress uses the shared bounded parser', () => {
  assert.match(policy, /PUBLIC_BOOKING_REQUEST_MAX_BYTES = 64 \* 1024/);
  assert.match(policy, /request\.body\.getReader\(\)/);
  assert.match(policy, /TextDecoder\('utf-8', \{ fatal: true \}\)/);
  assert.match(policy, /JSON\.parse\(rawBody\)/);
  assert.doesNotMatch(policy, /request\.json\(\)/);

  for (const path of publicRoutes) {
    const source = read(path);
    assert.match(source, /readPublicBookingJsonObject\(request\)/);
    assert.doesNotMatch(source, /request\.json\(\)/, `${path} must not bypass the bounded parser`);
    assert.match(source, /invalid-request/);
  }
});


test('public payment receipt uses a tighter document-capability ingress bound', () => {
  const source = read('app/api/public-bookings/[organization-slug]/hospitality/payments/receipt/route.ts');
  assert.match(source, /PUBLIC_PAYMENT_RECEIPT_REQUEST_MAX_BYTES = 8 \* 1024/);
  assert.match(source, /PUBLIC_PAYMENT_RECEIPT_CAPABILITY_MAX_CHARACTERS = 4096/);
  assert.match(source, /readPublicBookingJsonObject\(request, PUBLIC_PAYMENT_RECEIPT_REQUEST_MAX_BYTES\)/);
  assert.match(source, /bookingCapability\.length === 0/);
  assert.match(source, /bookingCapability\.length > PUBLIC_PAYMENT_RECEIPT_CAPABILITY_MAX_CHARACTERS/);
  assert.doesNotMatch(source, /request\.json\(\)/);
  assert.match(source, /invalid-request/);
});
