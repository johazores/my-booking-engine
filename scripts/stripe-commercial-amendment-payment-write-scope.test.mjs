import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const charge = source('src/server/bookings/hospitality-booking-commercial-amendment-stripe-charge-service.ts');
const refund = source('src/server/bookings/hospitality-booking-commercial-amendment-stripe-refund-service.ts');
const webhook = source('src/server/bookings/hospitality-booking-commercial-amendment-stripe-webhook-service.ts');

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

function assertExactWebhookEventScope(block, label) {
  for (const field of ['organizationId', 'providerCode', 'providerEventId', 'eventType', 'payloadHash']) {
    assert.match(block, new RegExp(`\\b${field}\\b`), `${label} must retain ${field} at the final webhook-event mutation`);
  }
}

test('direct commercial-amendment authorization and capture writes retain exact operation identity', () => {
  const blocks = mutationWhereBlocks(charge, 'paymentTransaction');
  assert.equal(blocks.length, 3);
  blocks.forEach((block, index) => {
    assertExactPaymentScope(block, `Direct charge mutation ${index + 1}`);
    assert.match(block, /sourceProviderReference:\s*null/, `Direct charge mutation ${index + 1} must remain source-less`);
  });
  assert.doesNotMatch(charge, /paymentTransaction\.update\(\{\s*where:\s*\{\s*id:\s*[^,}\n]+\s*\},/);

  assert.match(charge, /permission: 'booking:manage'/);
  assert.match(charge, /permission: 'payment:manage'/);
  assert.match(charge, /loadStripePaymentIntegration/);
  assert.match(charge, /pg_advisory_xact_lock/);
  assert.match(charge, /isolationLevel: 'Serializable'/);
});

test('source-scoped commercial-amendment refund writes retain exact operation identity', () => {
  const blocks = mutationWhereBlocks(refund, 'paymentTransaction');
  assert.equal(blocks.length, 3);
  blocks.forEach((block, index) => assertExactPaymentScope(block, `Refund mutation ${index + 1}`));
  assert.doesNotMatch(refund, /paymentTransaction\.update\(\{\s*where:\s*\{\s*id:\s*[^,}\n]+\s*\},/);
  assert.match(refund, /sourceProviderReference: claim\.claim\.sourceProviderReference/);
  assert.match(refund, /sourceProviderReference: payment\.sourceProviderReference/);

  assert.match(refund, /permission: 'booking:manage'/);
  assert.match(refund, /permission: 'payment:manage'/);
  assert.match(refund, /loadStripePaymentIntegration/);
  assert.match(refund, /pg_advisory_xact_lock/);
  assert.match(refund, /isolationLevel: 'Serializable'/);
});

test('signed non-Checkout amendment webhooks retain exact payment and verified event identity', () => {
  const paymentBlocks = mutationWhereBlocks(webhook, 'paymentTransaction');
  assert.equal(paymentBlocks.length, 2);
  paymentBlocks.forEach((block, index) => assertExactPaymentScope(block, `Webhook payment mutation ${index + 1}`));
  assert.match(paymentBlocks[0], /sourceProviderReference:\s*null/);
  assert.doesNotMatch(webhook, /paymentTransaction\.update\(\{\s*where:\s*\{\s*id:\s*[^,}\n]+\s*\},/);

  const eventBlocks = mutationWhereBlocks(webhook, 'paymentWebhookEvent');
  assert.equal(eventBlocks.length, 2);
  eventBlocks.forEach((block, index) => assertExactWebhookEventScope(block, `Webhook event mutation ${index + 1}`));
  assert.doesNotMatch(webhook, /paymentWebhookEvent\.update\(\{\s*where:\s*\{\s*id:\s*[^,}\n]+\s*\},/);

  assert.match(webhook, /parseStripeWebhookEventPayload/);
  assert.match(webhook, /createHash\('sha256'\)/);
  assert.match(webhook, /payloadHash,/);
  assert.match(webhook, /hospitalityBookingMutationLockKey/);
  assert.match(webhook, /pg_advisory_xact_lock/);
  assert.match(webhook, /isolationLevel: 'Serializable'/);
});

test('documentation preserves provider, apply, recovery, and validation boundaries', () => {
  const document = source('docs/stripe-commercial-amendment-payment-write-scope.md');
  assert.match(document, /defense-in-depth persistence boundary/i);
  assert.match(document, /provider calls remain behind the existing Stripe payment adapter/i);
  assert.match(document, /do not directly rewrite the booking commercial snapshot/i);
  assert.match(document, /expired-amendment Stripe recovery\/compensation state machines.*separate production review boundary/is);
  assert.match(document, /GitHub Actions are intentionally not used/i);
});
