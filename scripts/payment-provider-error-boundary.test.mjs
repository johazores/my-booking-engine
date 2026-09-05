import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PAYMENT_HTTP = 'src/server/payments/payment-http.ts';
const BOOKING_HTTP = 'src/server/bookings/hospitality-booking-http.ts';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('staff payment HTTP boundaries sanitize provider failures before presentation', async () => {
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
