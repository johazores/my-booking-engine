import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const stripeProviderPaths = [
  'src/server/payments/stripe-payment-provider.ts',
  'src/server/payments/stripe-checkout-provider.ts',
  'src/server/payments/stripe-payment-reconciliation-provider.ts',
  'src/server/payments/stripe-refund-reconciliation-provider.ts',
];

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Stripe transport timeout authority comes from the local abort signal', () => {
  for (const path of stripeProviderPaths) {
    const contents = source(path);
    assert.match(contents, /if \(controller\.signal\.aborted\)/, `${path} must classify timeout from its own AbortController signal`);
    assert.doesNotMatch(contents, /error\.name\s*===\s*['"]AbortError['"]/, `${path} must not trust a thrown error name as timeout authority`);
  }
});

test('all Stripe provider timeout configuration is bounded consistently', () => {
  for (const path of stripeProviderPaths) {
    const contents = source(path);
    assert.match(contents, /options\.timeoutMs < 1_000 \|\| options\.timeoutMs > 120_000/, `${path} must reject unsafe timeout bounds`);
    assert.match(contents, /Stripe timeout must be between 1000 and 120000 milliseconds\./, `${path} must expose the shared timeout validation contract`);
  }
});

test('Travelport operational abort classification uses the effective request signal only', () => {
  const contents = source('src/server/suppliers/travelport-stays-operational-log-fetch.ts');
  assert.match(contents, /function requestSignal\(input: RequestInfo \| URL, init\?: RequestInit\): AbortSignal \| null/);
  assert.match(contents, /if \(init\?\.signal\) return init\.signal;/);
  assert.match(contents, /input instanceof Request \? input\.signal : null/);
  assert.match(contents, /const signal = requestSignal\(requestInput, init\);/);
  assert.match(contents, /const aborted = signal\?\.aborted === true;/);
  assert.doesNotMatch(contents, /error\.name\s*===\s*['"]AbortError['"]/);
  assert.doesNotMatch(contents, /error instanceof DOMException/);
});
