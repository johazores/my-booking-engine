import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const checkoutRoutes = [
  'app/api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout/route.ts',
  'app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/stripe-checkout/route.ts',
  'app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/recovery/stripe-checkout/route.ts',
];

test('all customer and staff Checkout return destinations use configured origin, not request Host', () => {
  for (const path of checkoutRoutes) {
    const source = read(path);
    assert.match(source, /resolveStripeCheckoutReturnOrigin\(/, path);
    assert.match(source, /process\.env\.SF_CHECKOUT_RETURN_ORIGIN\s*\?\?\s*process\.env\.NEXT_PUBLIC_APP_URL/, path);
    assert.match(source, /process\.env\.NODE_ENV === 'production'/, path);
    assert.match(source, /const returnUrl = new URL\([^;]+, returnOrigin\)/, path);
    assert.doesNotMatch(source, /new URL\([^;]+, request\.url\)/, path);
  }
});

test('Checkout origin configuration failures remain customer-safe and do not invoke Stripe', () => {
  const publicRoute = read(checkoutRoutes[0]);
  const staffHttp = read('src/server/bookings/hospitality-booking-http.ts');
  assert.match(publicRoute, /error instanceof StripeCheckoutReturnOriginConfigurationError/);
  assert.match(publicRoute, /error: 'payment-unavailable'.*status: 503/);
  assert.match(staffHttp, /error instanceof StripeCheckoutReturnOriginConfigurationError/);
  assert.match(staffHttp, /error: 'payment-unavailable' \}, 503/);
});

test('Stripe Checkout adapter rejects parser-repaired return destinations before provider I/O', () => {
  const source = read('src/server/payments/stripe-checkout-provider.ts');
  assert.match(source, /value !== url\.href/);
  assert.match(source, /url\.hostname\.endsWith\('\.'\)/);
  assert.match(source, /return value;\s*}\s*\n\s*function normalizeStripeCheckoutUrl/);
});
