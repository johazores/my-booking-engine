import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const checkout = source('src/server/bookings/hospitality-booking-commercial-amendment-stripe-checkout-service.ts');
const webhook = source('src/server/bookings/hospitality-booking-commercial-amendment-stripe-checkout-webhook-service.ts');

function mutationWhereBlocks(text, model) {
  const pattern = new RegExp(`${model}\\.update\\(\\{\\s*where:\\s*\\{([\\s\\S]*?)\\n\\s*\\},\\s*data:`, 'g');
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function assertExactPaymentScope(block, label) {
  for (const field of [
    'organizationId',
    'bookingId',
    'commercialAmendmentId',
    'idempotencyKey',
    'requestFingerprint',
    'providerCode',
    'kind',
    'status',
    'providerReference',
    'sourceProviderReference',
    'currency',
    'amountMinor',
  ]) {
    assert.match(block, new RegExp(`\\b${field}\\b`), `${label} must retain ${field} at the final payment mutation`);
  }
}

test('Checkout service payment mutations retain exact tenant and operation identity', () => {
  const blocks = mutationWhereBlocks(checkout, 'paymentTransaction');
  assert.equal(blocks.length, 3);
  blocks.forEach((block, index) => assertExactPaymentScope(block, `Checkout service mutation ${index + 1}`));

  assert.doesNotMatch(checkout, /paymentTransaction\.update\(\{\s*where:\s*\{\s*id:\s*[^,}\n]+\s*\},/);
  assert.match(checkout, /status: 'AMBIGUOUS',\s*providerReference: payment\.providerReference,\s*sourceProviderReference: null,\s*currency: payment\.currency,\s*amountMinor: payment\.amountMinor,/);
  assert.match(checkout, /requestFingerprint: input\.requestFingerprint,[\s\S]*status: 'AMBIGUOUS',[\s\S]*currency: input\.currency,\s*amountMinor: input\.amountMinor,/);
});

test('signed Checkout webhook retains exact payment and verified event scope', () => {
  const paymentBlocks = mutationWhereBlocks(webhook, 'paymentTransaction');
  assert.equal(paymentBlocks.length, 1);
  assertExactPaymentScope(paymentBlocks[0], 'Checkout webhook payment mutation');
  assert.doesNotMatch(webhook, /paymentTransaction\.update\(\{\s*where:\s*\{\s*id:\s*[^,}\n]+\s*\},/);

  const eventBlocks = mutationWhereBlocks(webhook, 'paymentWebhookEvent');
  assert.equal(eventBlocks.length, 2);
  for (const [index, block] of eventBlocks.entries()) {
    for (const field of ['organizationId', 'providerCode', 'providerEventId', 'eventType', 'payloadHash']) {
      assert.match(block, new RegExp(`\\b${field}\\b`), `Checkout webhook event mutation ${index + 1} must retain ${field}`);
    }
  }
  assert.doesNotMatch(webhook, /paymentWebhookEvent\.update\(\{\s*where:\s*\{\s*id:\s*[^,}\n]+\s*\},/);
});

test('authorization, locking, provider, and lifecycle boundaries remain explicit', () => {
  assert.match(checkout, /permission: 'booking:manage'/);
  assert.match(checkout, /permission: 'payment:manage'/);
  assert.match(checkout, /loadStripeCheckoutIntegration/);
  assert.match(checkout, /pg_advisory_xact_lock/);
  assert.match(checkout, /isolationLevel: 'Serializable'/);
  assert.match(webhook, /parseStripeCommercialAmendmentCheckoutWebhook/);
  assert.match(webhook, /payloadHash/);
  assert.match(webhook, /hospitalityBookingMutationLockKey/);
  assert.match(webhook, /isolationLevel: 'Serializable'/);

  const document = source('docs/stripe-commercial-amendment-checkout-write-scope.md');
  assert.match(document, /defense in depth/i);
  assert.match(document, /successful Checkout does not rewrite the booking commercial snapshot directly/i);
  assert.match(document, /direct Stripe authorization\/capture flow.*refund flow.*recovery state machines/i);
  assert.match(document, /GitHub Actions are intentionally not used/i);
});
