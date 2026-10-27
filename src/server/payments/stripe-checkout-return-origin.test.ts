import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStripeCheckoutReturnOrigin, StripeCheckoutReturnOriginConfigurationError } from './stripe-checkout-return-origin.ts';

test('Stripe Checkout return navigation uses only canonical deployment origins', () => {
  assert.equal(resolveStripeCheckoutReturnOrigin('https://booking.example.test', true), 'https://booking.example.test');
  assert.equal(resolveStripeCheckoutReturnOrigin('https://booking.example.test/', true), 'https://booking.example.test');
  assert.equal(resolveStripeCheckoutReturnOrigin('https://booking.example.test:8443', true), 'https://booking.example.test:8443');
  assert.equal(resolveStripeCheckoutReturnOrigin('http://localhost:3000', false), 'http://localhost:3000');
  assert.equal(resolveStripeCheckoutReturnOrigin('http://127.0.0.1:3000/', false), 'http://127.0.0.1:3000');
});

test('Stripe Checkout return origin rejects untrusted or normalized deployment URL evidence', () => {
  for (const candidate of [
    undefined, null, '', 123, {}, ' https://booking.example.test',
    'https://booking.example.test\n', 'https://booking.example.test\u0000',
    'https://booking.example.test\ud800',
    'https://BOOKING.example.test',
    'https://booking.example.test:443',
    'https://booking.example.test.',
    'https://user@booking.example.test',
    'https://booking.example.test/path',
    'https://booking.example.test/%2e',
    'https://booking.example.test/?',
    'https://booking.example.test/#',
    'https://booking.example.test?next=https://evil.test',
    'https://booking.example.test#redirect',
    'https://booking.example.test\\@evil.test',
    'https://booking.example.test/' + 'a'.repeat(2_048),
    'http://booking.example.test',
    'javascript:alert(1)',
  ]) {
    assert.throws(
      () => resolveStripeCheckoutReturnOrigin(candidate, true),
      (error: unknown) => error instanceof StripeCheckoutReturnOriginConfigurationError,
      String(candidate),
    );
  }
});

test('production never redirects Checkout customers to local or HTTP origins', () => {
  for (const candidate of [
    'http://localhost:3000',
    'https://localhost:3000',
    'https://127.0.0.1',
    'https://[::1]',
    'http://booking.example.test',
    'http://sub.localhost:3000',
  ]) {
    assert.throws(() => resolveStripeCheckoutReturnOrigin(candidate, true), StripeCheckoutReturnOriginConfigurationError);
  }
  assert.throws(() => resolveStripeCheckoutReturnOrigin('http://booking.example.test', false), StripeCheckoutReturnOriginConfigurationError);
});

test('configured origin controls the return host even when an inbound Host URL is attacker-controlled', () => {
  const trusted = resolveStripeCheckoutReturnOrigin('https://booking.example.test', true);
  const untrustedRequestUrl = 'https://attacker.example.test/api/public-bookings/tenant/hospitality/payments/stripe-checkout';
  const returnUrl = new URL('/book/tenant', trusted);
  returnUrl.searchParams.set('payment', 'processing');
  assert.equal(returnUrl.origin, 'https://booking.example.test');
  assert.equal(returnUrl.toString(), 'https://booking.example.test/book/tenant?payment=processing');
  assert.notEqual(returnUrl.origin, new URL(untrustedRequestUrl).origin);
});
