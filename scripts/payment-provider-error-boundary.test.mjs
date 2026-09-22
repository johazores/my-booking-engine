import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PROVIDER = 'src/server/payments/payment-provider.ts';
const PAYMENT_HTTP = 'src/server/payments/payment-http.ts';
const BOOKING_HTTP = 'src/server/bookings/hospitality-booking-http.ts';
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

test('staff payment HTTP boundaries sanitize branded provider failures before presentation', async () => {
  for (const path of [PAYMENT_HTTP, BOOKING_HTTP]) {
    const source = await read(path);
    assert.match(source, /paymentProviderClientError/);
    assert.match(source, /\.\.\.paymentProviderClientError\(error\)/);
    const providerBranch = source.slice(source.indexOf('if (error instanceof PaymentProviderError)'), source.indexOf('if (error instanceof PaymentProviderError)') + 500);
    assert.equal(/message:\s*error\.message/.test(providerBranch), false, `${path} must not return raw provider messages`);
  }
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
