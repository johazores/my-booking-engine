import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = [
  'src/server/bookings/public-booking-http-policy.ts',
  'src/server/bookings/hospitality-booking-http.ts',
  'src/server/payments/payment-http.ts',
  'src/server/payments/public-tax-document-http.ts',
];

test('all JSON request policies delegate to one bounded, length-checked transport reader', () => {
  for (const path of routes) {
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    assert.match(source, /import \{ readBoundedJsonObject \} from '\.\.\/http\/bounded-json-body\.ts'/, path);
    assert.match(source, /\b(?:await|return) readBoundedJsonObject\(request, /, path);
    assert.doesNotMatch(source, /function hasAcceptableContentLength|function readBoundedRequestText/, path);
  }
  const shared = readFileSync(new URL('../src/server/http/bounded-json-body.ts', import.meta.url), 'utf8');
  assert.match(shared, /totalBytes > declaredBytes/);
  assert.match(shared, /totalBytes !== declaredBytes/);
  assert.match(shared, /const JSON_REQUEST_MAX_CHUNKS = 16 \* 1024/);
  assert.match(shared, /chunkCount > JSON_REQUEST_MAX_CHUNKS/);
  assert.doesNotMatch(shared, /await reader\.cancel\(/);
  const tests = readFileSync(new URL('../src/server/http/bounded-json-body.test.ts', import.meta.url), 'utf8');
  assert.match(tests, /rejects endless zero-byte chunks/);
  assert.match(tests, /rejects excessive tiny chunks/);
});
