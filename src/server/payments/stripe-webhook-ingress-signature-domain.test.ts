import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STRIPE_WEBHOOK_MAX_SIGNATURE_HEADER_CHARS,
  hasPlausibleStripeWebhookSignatureHeader,
  parseStripeWebhookSignatureHeader,
} from './stripe-webhook-ingress-signature-domain.ts';

const signature = 'a'.repeat(64);

test('parses one Stripe timestamp with rotation signatures and ignores unknown schemes', () => {
  assert.deepEqual(
    parseStripeWebhookSignatureHeader(`t=1800000000,v1=${signature},v1=${'b'.repeat(64)},v0=legacy`),
    { timestamp: 1_800_000_000, signatures: [signature, 'b'.repeat(64)] },
  );
  assert.equal(hasPlausibleStripeWebhookSignatureHeader(`t=1800000000,v1=${signature}`), true);
});

test('returns immutable parsed signature evidence', () => {
  const parsed = parseStripeWebhookSignatureHeader(`t=1800000000,v1=${signature}`);
  assert.ok(parsed);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.signatures), true);
});

test('rejects absent, empty, and oversized signature headers', () => {
  assert.equal(parseStripeWebhookSignatureHeader(null), null);
  assert.equal(parseStripeWebhookSignatureHeader(''), null);
  assert.equal(parseStripeWebhookSignatureHeader('x'.repeat(STRIPE_WEBHOOK_MAX_SIGNATURE_HEADER_CHARS + 1)), null);
});

test('rejects framing without exactly one safe non-zero timestamp', () => {
  assert.equal(parseStripeWebhookSignatureHeader(`v1=${signature}`), null);
  assert.equal(parseStripeWebhookSignatureHeader(`t=0,v1=${signature}`), null);
  assert.equal(parseStripeWebhookSignatureHeader(`t=not-a-time,v1=${signature}`), null);
  assert.equal(parseStripeWebhookSignatureHeader(`t=99999999999999999,v1=${signature}`), null);
  assert.equal(parseStripeWebhookSignatureHeader(`t=1,t=1800000000,v1=${signature}`), null);
  assert.equal(parseStripeWebhookSignatureHeader(`t=1800000000,t=0,v1=${signature}`), null);
});

test('rejects framing without a structurally valid v1 HMAC candidate', () => {
  assert.equal(parseStripeWebhookSignatureHeader('t=1800000000,v0=legacy'), null);
  assert.equal(parseStripeWebhookSignatureHeader('t=1800000000,v1=not-hex'), null);
  assert.equal(parseStripeWebhookSignatureHeader(`t=1800000000,v1=${'a'.repeat(63)}`), null);
});

test('ignores malformed rotation candidates when another v1 candidate is structurally valid', () => {
  assert.deepEqual(
    parseStripeWebhookSignatureHeader(`t=1800000000,v1=bad,v1=${signature}`),
    { timestamp: 1_800_000_000, signatures: [signature] },
  );
});
