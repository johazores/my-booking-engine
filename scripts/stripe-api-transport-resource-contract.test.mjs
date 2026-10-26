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
  assert.match(contents, /hasUtf8ByteLengthAtMost\(body, MAX_STRIPE_API_REQUEST_BYTES\)/);
  assert.match(contents, /response\.headers\.get\('content-length'\)/);
  assert.match(contents, /byteLength > MAX_STRIPE_API_RESPONSE_BYTES - totalBytes/);
  assert.match(contents, /Reflect\.get\(Object\.getPrototypeOf\(Uint8Array\.prototype\), 'byteLength', value\)/);
  assert.match(contents, /Uint8Array\.prototype\.set\.call\(chunk, value\)/);
  assert.match(contents, /chunks\.push\(chunk\)/);
  assert.match(contents, /if \(!\(value instanceof Uint8Array\)\) invalidTransportResponse\(\)/);
  assert.match(contents, /catch \(error\) \{[\s\S]*reader\.cancel\(\)\.catch/);
  assert.match(contents, /reader\.releaseLock\(\)/);
  assert.match(contents, /responseBody = response\.body/);
  assert.match(contents, /if \(responseBody === null\) return replayStripeApiResponse\(response, null, signal\)/);
  assert.doesNotMatch(contents, /if \(responseBody === null\) return response/);
  assert.match(contents, /reader = responseBody\.getReader\(\)/);
  assert.match(contents, /if \(error instanceof PaymentProviderError\) throw error;\s*invalidTransportResponse\(\)/);
});

test('Stripe response acquisition keeps abort authority and post-provider ambiguity fail closed', () => {
  const contents = source('src/server/payments/stripe-api-transport.ts');
  assert.match(contents, /AbortSignal\.prototype\.addEventListener\.call\(signal, 'abort', onAbort, \{ once: true \}\)/);
  assert.match(contents, /void reader\.cancel\(\)\.catch\(\(\) => undefined\)/);
  assert.match(contents, /function cancelStripeResponseBody\(response: Response\): void \{\s*try \{/);
  assert.match(contents, /if \(signal && nativeStripeSignalAborted\(signal\)\) \{\s*cancelStripeResponseBody\(response\);\s*throw abortResponseRead\(\);\s*\}/);
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
  assert.match(docs, /malformed chunks fail as retryable unknown provider evidence/);
  assert.match(docs, /reader lock is released/);
  assert.match(docs, /complete response body/i);
  assert.match(docs, /retryable `UNKNOWN`/);
  assert.match(tests, /keeps caller abort authority active through response body acquisition/);
  assert.match(tests, /enforces the response ceiling on streamed bytes/);
  assert.match(tests, /classifies failed reads as unknown provider evidence/);
  assert.match(tests, /locked response bodies as retryable unknown provider evidence/);
  assert.match(tests, /preserves a real timeout over malformed provider response headers/);
  assert.match(tests, /normalizes throwing provider response headers/);
  assert.match(tests, /ignores synchronous cancellation failures/);
  assert.match(tests, /normalizes malformed replay metadata/);
  assert.match(tests, /normalizes reader lock-release failures/);
});

test('Stripe transport materializes caller metadata once and checks native abort authority', () => {
  const contents = source('src/server/payments/stripe-api-transport.ts');
  const tests = source('src/server/payments/stripe-api-transport.test.ts');
  assert.match(contents, /method = init\.method;/);
  assert.match(contents, /body = init\.body;/);
  assert.match(contents, /signal = init\.signal;/);
  assert.match(contents, /headersInput = init\.headers;/);
  assert.match(contents, /Reflect\.get\(AbortSignal\.prototype, 'aborted', signal\)/);
  assert.doesNotMatch(contents, /signal(?:\?\.)?\.aborted/);
  assert.match(contents, /if \(nativeStripeSignalAborted\(signal\)\) \{\s*onAbort\(\);\s*return;/);
  assert.match(tests, /ignores shadowed native signal fields/);
  assert.match(tests, /honors real abort despite shadowed signal fields/);
  assert.match(contents, /reviewedHeaders\(headersInput, method, body\)/);
  assert.match(contents, /signal: readySignal/);
  assert.doesNotMatch(contents, /body: init\.body/);
  assert.match(tests, /snapshots request body, signal, method, and headers once/);
  assert.match(tests, /rejects forged signals before network I\/O/);
  assert.match(tests, /normalizes throwing RequestInit getters/);
});
