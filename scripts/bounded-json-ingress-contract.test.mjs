import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
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
    assert.match(source, /await readBoundedJsonObject\(request, /, path);
    assert.doesNotMatch(source, /function hasAcceptableContentLength|function readBoundedRequestText/, path);
  }
  const shared = readFileSync(new URL('../src/server/http/bounded-json-body.ts', import.meta.url), 'utf8');
  assert.match(shared, /totalBytes > declaredBytes/);
  assert.match(shared, /totalBytes !== declaredBytes/);
});
