import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PROVIDER = 'src/server/payments/payment-provider.ts';
const CLIENT_ERROR = 'src/server/payments/payment-provider-client-error.ts';
const PAYMENT_HTTP = 'src/server/payments/payment-http.ts';
const BOOKING_HTTP = 'src/server/bookings/hospitality-booking-http.ts';
const PUBLIC_CHECKOUT_ROUTE = 'app/api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout/route.ts';
const DOCUMENTATION = 'docs/payment-provider-error-boundary.md';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('payment provider machine failures require private constructor authority', async () => {
  const [source, documentation] = await Promise.all([read(PROVIDER), read(DOCUMENTATION)]);
  assert.match(source, /paymentProviderFailureCodes = \[/);
  assert.match(source, /new WeakMap<object, PaymentProviderFailure>\(\)/);
  assert.match(source, /static \[Symbol\.hasInstance\]\(value: unknown\): boolean/);
  assert.match(source, /paymentProviderErrorAuthority\.has\(value\)/);
  assert.match(source, /Object\.defineProperties\(this, \{/);
  assert.match(source, /writable: false/);
  assert.match(source, /configurable: false/);
  assert.match(source, /inspectPaymentProviderFailure/);
  assert.match(documentation, /prototype lookalikes do not qualify/i);
  assert.match(documentation, /non-writable and non-configurable/i);
  assert.match(documentation, /durable payment\/refund claim settlement/i);
});

test('staff payment HTTP boundaries materialize client-safe failures from constructor authority', async () => {
  for (const path of [PAYMENT_HTTP, BOOKING_HTTP]) {
    const source = await read(path);
    assert.match(source, /paymentProviderClientErrorFromThrown/);
    assert.match(source, /const providerError = paymentProviderClientErrorFromThrown\(error\)/);
    assert.equal(source.includes('PaymentProviderError'), false, `${path} should not re-read provider failure fields for presentation`);
    assert.equal(/message:\s*error\.message/.test(source), false, `${path} must not return raw provider messages`);
    assert.equal(/error\.retryable/.test(source), false, `${path} must use the inspected snapshot for retry presentation`);
  }
});

test('payment client presentation has a narrower public checkout contract', async () => {
  const [clientSource, routeSource, documentation] = await Promise.all([
    read(CLIENT_ERROR),
    read(PUBLIC_CHECKOUT_ROUTE),
    read(DOCUMENTATION),
  ]);

  assert.match(clientSource, /inspectPaymentProviderFailure/);
  assert.match(clientSource, /paymentProviderClientErrorFromThrown\(error: unknown\)/);
  assert.match(clientSource, /publicPaymentProviderClientError\(error: unknown\)/);
  assert.match(clientSource, /failure\.retryable/);
  assert.match(clientSource, /failure\.code === 'DECLINED'/);
  assert.match(clientSource, /payment-temporarily-unavailable/);
  assert.match(clientSource, /payment-rejected/);
  assert.match(clientSource, /payment-unavailable/);

  assert.match(routeSource, /publicPaymentProviderClientError\(error\)/);
  assert.equal(routeSource.includes('PaymentProviderError'), false);
  assert.equal(/error\.retryable/.test(routeSource), false);
  assert.equal(/error\.code/.test(routeSource), false);
  assert.equal(/message:\s*error\.message/.test(routeSource), false);

  assert.match(documentation, /only.*DECLINED.*customer rejection/is);
  assert.match(documentation, /never exposes.*failure code/is);
});

test('payment HTTP responses disable caching at the shared boundary', async () => {
  const source = await read(PAYMENT_HTTP);
  assert.match(source, /PAYMENT_NO_STORE_HEADERS/);
  assert.match(source, /'cache-control': 'no-store'/);
  assert.match(source, /headers:\s*\{ 'content-type': 'application\/json; charset=utf-8', \.\.\.PAYMENT_NO_STORE_HEADERS \}/);
  assert.match(source, /Response\.json\(body, \{ status, headers: PAYMENT_NO_STORE_HEADERS \}\)/);
  assert.match(source, /authentication-required[\s\S]{0,160}PAYMENT_NO_STORE_HEADERS/);
  assert.match(source, /organization-required[\s\S]{0,160}PAYMENT_NO_STORE_HEADERS/);
});

test('hospitality booking shared responses disable caching before and after tenant resolution', async () => {
  const source = await read(BOOKING_HTTP);
  assert.match(source, /HOSPITALITY_BOOKING_NO_STORE_HEADERS/);
  assert.match(source, /authentication-required[\s\S]{0,180}HOSPITALITY_BOOKING_NO_STORE_HEADERS/);
  assert.match(source, /organization-required[\s\S]{0,180}HOSPITALITY_BOOKING_NO_STORE_HEADERS/);
  assert.match(source, /headers:\s*\{ 'content-type': 'application\/json; charset=utf-8', \.\.\.HOSPITALITY_BOOKING_NO_STORE_HEADERS \}/);
  assert.match(source, /Response\.json\(body, \{ status, headers: HOSPITALITY_BOOKING_NO_STORE_HEADERS \}\)/);
});
