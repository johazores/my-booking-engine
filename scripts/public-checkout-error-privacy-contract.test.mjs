import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(
  new URL('../app/api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout/route.ts', import.meta.url),
  'utf8',
);

test('public Checkout validates the browser request key through the typed UUID-v4 boundary', () => {
  assert.match(route, /normalizePublicBookingRequestKey, PublicBookingRequestValidationError/);
  const normalizeIndex = route.indexOf('requestKey = normalizePublicBookingRequestKey(input.requestKey)');
  const serviceIndex = route.indexOf('createPublicStripeCheckoutSession({');
  assert.ok(normalizeIndex >= 0);
  assert.ok(serviceIndex > normalizeIndex);
  assert.match(route, /error instanceof PublicBookingRequestValidationError/);
  assert.match(route, /return finish\(Response\.json\(\{ error: 'invalid-request' \}/);
});

test('public Checkout does not classify arbitrary internal messages as client validation', () => {
  assert.doesNotMatch(route, /error instanceof Error &&/);
  assert.doesNotMatch(route, /\{ error: 'validation', message: error\.message \}/);
  assert.match(
    route,
    /return Response\.json\(\{ error: 'internal-error' \}, \{ status: 500, headers: noStoreHeaders \}\)/,
  );
});
