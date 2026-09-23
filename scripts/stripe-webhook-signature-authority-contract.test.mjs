import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const signatureDomain = source('src/server/payments/stripe-webhook-ingress-signature-domain.ts');
const stripeProvider = source('src/server/payments/stripe-payment-provider.ts');
const document = source('docs/stripe-webhook-write-scope.md');

test('Stripe webhook signature framing has one shared parser and rejects timestamp ambiguity', () => {
  assert.match(signatureDomain, /export function parseStripeWebhookSignatureHeader/);
  assert.match(signatureDomain, /let timestampSeen = false/);
  assert.match(signatureDomain, /if \(timestampSeen\) return null/);
  assert.match(signatureDomain, /signatures\.push\(candidate\)/);
  assert.match(signatureDomain, /Object\.freeze\(\{ timestamp, signatures: Object\.freeze\(\[\.\.\.signatures\]\) \}\)/);
  assert.match(signatureDomain, /return parseStripeWebhookSignatureHeader\(value\) !== null/);
  assert.doesNotMatch(signatureDomain, /createHmac|timingSafeEqual|webhookTolerance/i);
});

test('Stripe payment provider consumes shared framing evidence before HMAC authority', () => {
  assert.match(stripeProvider, /import \{ parseStripeWebhookSignatureHeader \} from '\.\/stripe-webhook-ingress-signature-domain\.ts'/);
  assert.match(stripeProvider, /const parsed = parseStripeWebhookSignatureHeader\(input\.signature\)/);
  assert.match(stripeProvider, /createHmac\('sha256', secret\)\.update\(`\$\{parsed\.timestamp\}\.\$\{input\.payload\}`/);
  assert.match(stripeProvider, /parsed\.signatures\.some/);
  assert.doesNotMatch(stripeProvider, /function parseStripeSignature/);
});

test('shared Stripe signature authority is documented without promoting preflight to HMAC verification', () => {
  assert.match(document, /exactly one unambiguous timestamp/i);
  assert.match(document, /shared framing parser/i);
  assert.match(document, /multiple `v1` candidates/i);
  assert.match(document, /HMAC verification and timestamp tolerance remain in the Stripe provider/i);
});
