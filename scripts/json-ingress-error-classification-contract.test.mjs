import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/server/payments/payment-http.ts', 'utf8');

test('payment ingress owns malformed JSON classification explicitly', () => {
  assert.match(source, /error instanceof PaymentApiPayloadError/);
  assert.doesNotMatch(source, /error instanceof SyntaxError/);
});
