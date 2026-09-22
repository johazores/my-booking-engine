import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Stripe credentialed transport owns bounded request and response resources', () => {
  const contents = source('src/server/payments/stripe-api-transport.ts');
  assert.match(contents, /const MAX_STRIPE_API_REQUEST_BYTES = 256 \* 1024;/);
  assert.match(contents, /const MAX_STRIPE_API_RESPONSE_BYTES = 4 \* 1024 \* 1024;/);
  assert.match(contents, /hasUtf8ByteLengthAtMost\(init\.body, MAX_STRIPE_API_REQUEST_BYTES\)/);
  assert.match(contents, /response\.headers\.get\('content-length'\)/);
  assert.match(contents, /totalBytes > MAX_STRIPE_API_RESPONSE_BYTES/);
  assert.match(contents, /chunks\.push\(value\.slice\(\)\)/);
});

test('Stripe response acquisition keeps abort authority and post-provider ambiguity fail closed', () => {
  const contents = source('src/server/payments/stripe-api-transport.ts');
  assert.match(contents, /signal\.addEventListener\('abort', onAbort, \{ once: true \}\)/);
  assert.match(contents, /void reader\.cancel\(\)\.catch\(\(\) => undefined\)/);
  assert.match(contents, /new PaymentProviderError\('UNKNOWN', 'Stripe API response is outside the reviewed SF provider boundary\.', true\)/);
  assert.match(contents, /return bufferStripeApiResponse\(response, init\.signal \?\? undefined\)/);
});

test('Stripe replay strips wire representation metadata and fixes sensitive Fetch policy', () => {
  const contents = source('src/server/payments/stripe-api-transport.ts');
  assert.match(contents, /headers\.delete\('content-length'\)/);
  assert.match(contents, /headers\.delete\('content-encoding'\)/);
  assert.match(contents, /cache: 'no-store'/);
  assert.match(contents, /credentials: 'omit'/);
  assert.match(contents, /redirect: 'manual'/);
  assert.match(contents, /referrerPolicy: 'no-referrer'/);
  assert.match(contents, /keepalive: false/);
  assert.match(contents, /integrity: ''/);
});

test('Stripe transport resource policy and regression coverage are documented', () => {
  const docs = source('docs/stripe-api-transport-policy.md');
  const tests = source('src/server/payments/stripe-api-transport.test.ts');
  assert.match(docs, /256 KiB/);
  assert.match(docs, /4 MiB/);
  assert.match(docs, /complete response body/i);
  assert.match(docs, /retryable `UNKNOWN`/);
  assert.match(tests, /keeps caller abort authority active through response body acquisition/);
  assert.match(tests, /enforces the response ceiling on streamed bytes/);
});
