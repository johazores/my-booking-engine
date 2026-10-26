import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('JSON, form, and Stripe ingress share one canonical framing policy', () => {
  const shared = source('src/server/http/request-body-deadline.ts');
  assert.match(shared, /export function inspectRequestBodyFraming\(/);
  assert.match(shared, /request\.headers\.has\('transfer-encoding'\)/);
  assert.match(shared, /rawLength\.length > 16/);
  for (const path of [
    'src/server/http/bounded-json-body.ts',
    'src/server/http/bounded-form-body.ts',
    'src/server/payments/stripe-webhook-request-body.ts',
  ]) {
    const reader = source(path);
    assert.match(reader, /inspectRequestBodyFraming\(request,/);
    assert.doesNotMatch(reader, /const (contentLength|lengthHeader) = request\.headers\.get\('content-length'\)/);
  }
});
