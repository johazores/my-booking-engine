import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const stripeOutboundCallSites = [
  'src/server/integrations/stripe-integration.ts',
  'src/server/payments/stripe-payment-provider.ts',
  'src/server/payments/stripe-checkout-provider.ts',
  'src/server/payments/stripe-payment-reconciliation-provider.ts',
  'src/server/payments/stripe-refund-reconciliation-provider.ts',
];

const stripePaymentProviderPaths = stripeOutboundCallSites.slice(1);

test('all implemented Stripe REST callers use the shared API transport boundary', () => {
  for (const path of stripeOutboundCallSites) {
    const contents = source(path);
    assert.match(contents, /requestStripeApi\(/, `${path} must use the shared Stripe transport boundary`);
  }

  assert.doesNotMatch(source('src/server/integrations/stripe-integration.ts'), /await \(input\.fetchImpl \?\? fetch\)\(/);
  for (const path of stripePaymentProviderPaths) {
    assert.doesNotMatch(source(path), /await this\.fetchImpl\(/, `${path} must not bypass the shared Stripe transport boundary`);
  }
});

test('Stripe transport owns target, endpoint, headers, idempotency, and Fetch metadata policy', () => {
  const contents = source('src/server/payments/stripe-api-transport.ts');
  assert.match(contents, /const STRIPE_API_ORIGIN = 'https:\/\/api\.stripe\.com';/);
  assert.match(contents, /path === '\/v1\/balance'/);
  assert.match(contents, /path === '\/v1\/payment_intents'/);
  assert.match(contents, /path === '\/v1\/refunds'/);
  assert.match(contents, /path === '\/v1\/checkout\/sessions'/);
  assert.match(contents, /const STRIPE_GET_HEADERS = new Set\(\['authorization'\]\);/);
  assert.match(contents, /const STRIPE_POST_HEADERS = new Set\(\['authorization', 'content-type', 'idempotency-key'\]\);/);
  assert.match(contents, /credentials: 'omit'/);
  assert.match(contents, /redirect: 'manual'/);
  assert.match(contents, /cache: 'no-store'/);
  assert.match(contents, /referrerPolicy: 'no-referrer'/);
  assert.match(contents, /keepalive: false/);
  assert.doesNotMatch(contents, /\.\.\.init/);
});

test('Stripe provider constructors bound secret material consistently with integration configuration', () => {
  for (const path of stripePaymentProviderPaths) {
    assert.match(source(path), /secretKey\.length > 4_096/, `${path} must bound secret key length`);
  }
  assert.match(source('src/server/integrations/stripe-integration.ts'), /secretKey\.length > 4096/);
});

test('Stripe transport policy is documented as a server-side credential boundary', () => {
  const contents = source('docs/stripe-api-transport-policy.md');
  assert.match(contents, /manual redirects/i);
  assert.match(contents, /credentials.*omit/i);
  assert.match(contents, /Idempotency-Key/);
  assert.match(contents, /api\.stripe\.com/);
  assert.match(contents, /Node 24/i);
});
