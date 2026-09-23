import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STRIPE_WEBHOOK_MAX_SIGNATURE_HEADER_CHARS,
  hasPlausibleStripeWebhookSignatureHeader,
} from './stripe-webhook-ingress-signature-domain.ts';

const signature = 'a'.repeat(64);

test('accepts Stripe timestamp and v1 framing including rotation signatures and unknown schemes', () => {
  assert.equal(hasPlausibleStripeWebhookSignatureHeader(`t=1800000000,v1=${signature}`), true);
  assert.equal(
    hasPlausibleStripeWebhookSignatureHeader(`t=1800000000,v1=${signature},v1=${'b'.repeat(64)},v0=legacy`),
    true,
  );
});

test('rejects absent, empty, and oversized signature headers', () => {
  assert.equal(hasPlausibleStripeWebhookSignatureHeader(null), false);
  assert.equal(hasPlausibleStripeWebhookSignatureHeader(''), false);
  assert.equal(hasPlausibleStripeWebhookSignatureHeader('x'.repeat(STRIPE_WEBHOOK_MAX_SIGNATURE_HEADER_CHARS + 1)), false);
});

test('rejects framing without a safe non-zero timestamp', () => {
  assert.equal(hasPlausibleStripeWebhookSignatureHeader(`v1=${signature}`), false);
  assert.equal(hasPlausibleStripeWebhookSignatureHeader(`t=0,v1=${signature}`), false);
  assert.equal(hasPlausibleStripeWebhookSignatureHeader(`t=not-a-time,v1=${signature}`), false);
  assert.equal(hasPlausibleStripeWebhookSignatureHeader(`t=99999999999999999,v1=${signature}`), false);
});

test('rejects framing without a structurally valid v1 HMAC candidate', () => {
  assert.equal(hasPlausibleStripeWebhookSignatureHeader('t=1800000000,v0=legacy'), false);
  assert.equal(hasPlausibleStripeWebhookSignatureHeader('t=1800000000,v1=not-hex'), false);
  assert.equal(hasPlausibleStripeWebhookSignatureHeader(`t=1800000000,v1=${'a'.repeat(63)}`), false);
});

test('matches provider last-timestamp parsing without treating preflight as HMAC authority', () => {
  assert.equal(hasPlausibleStripeWebhookSignatureHeader(`t=1,t=1800000000,v1=${signature}`), true);
  assert.equal(hasPlausibleStripeWebhookSignatureHeader(`t=1800000000,t=0,v1=${signature}`), false);
});
