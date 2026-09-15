import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const executor = source('src/server/bookings/hospitality-booking-commercial-amendment-stripe-recovery-service.ts');
const checkout = source('src/server/bookings/hospitality-booking-commercial-amendment-stripe-recovery-checkout-service.ts');
const checkoutReconciliation = source('src/server/bookings/hospitality-booking-commercial-amendment-stripe-recovery-checkout-reconciliation-service.ts');
const checkoutWebhook = source('src/server/bookings/hospitality-booking-commercial-amendment-stripe-recovery-checkout-webhook-service.ts');
const providerWebhook = source('src/server/bookings/hospitality-booking-commercial-amendment-stripe-recovery-webhook-service.ts');

function updateCount(text, model) {
  return [...text.matchAll(new RegExp(`${model}\\.update\\(\\{`, 'g'))].length;
}

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

test('expired amendment recovery executor centralizes exact payment mutation identity', () => {
  const helper = executor.match(/function exactRecoveryPaymentMutationWhere[\\s\\S]*?\n\}/)?.[0] ?? '';
  assertExactPaymentScope(helper, 'Recovery executor helper');
  assert.equal(updateCount(executor, 'paymentTransaction'), 5);
  assert.equal([...executor.matchAll(/where:\s*exactRecoveryPaymentMutationWhere\(\{/g)].length, 5);
  assert.doesNotMatch(executor, /paymentTransaction\.update\(\{\s*where:\s*\{\s*id:\s*[^,}\n]+\s*\},/);
  assert.match(executor, /permission: 'booking:manage'/);
  assert.match(executor, /permission: 'payment:manage'/);
  assert.match(executor, /loadStripePaymentIntegration/);
  assert.match(executor, /pg_advisory_xact_lock/);
  assert.match(executor, /isolationLevel: 'Serializable'/);
});

test('recovery Checkout creation and polling retain exact payment identity', () => {
  const checkoutBlocks = mutationWhereBlocks(checkout, 'paymentTransaction');
  assert.equal(checkoutBlocks.length, 2);
  checkoutBlocks.forEach((block, index) => assertExactPaymentScope(block, `Recovery Checkout mutation ${index + 1}`));
  assert.match(checkoutBlocks[0], /sourceProviderReference:\s*null/);
  assert.match(checkoutBlocks[1], /sourceProviderReference:\s*null/);
  assert.doesNotMatch(checkout, /paymentTransaction\.update\(\{\s*where:\s*\{\s*id:\s*[^,}\n]+\s*\},/);

  const reconciliationBlocks = mutationWhereBlocks(checkoutReconciliation, 'paymentTransaction');
  assert.equal(reconciliationBlocks.length, 1);
  assertExactPaymentScope(reconciliationBlocks[0], 'Recovery Checkout reconciliation mutation');
  assert.match(reconciliationBlocks[0], /sourceProviderReference:\s*null/);
  assert.match(checkout, /loadStripeCheckoutIntegration/);
  assert.match(checkoutReconciliation, /loadStripeCheckoutIntegration/);
  assert.match(checkout, /pg_advisory_xact_lock/);
  assert.match(checkoutReconciliation, /pg_advisory_xact_lock/);
});

test('signed recovery Checkout webhook retains payment and verified ledger identity', () => {
  const paymentWhere = checkoutWebhook.match(/const paymentWhere = \{[\s\S]*?\n    \};/)?.[0] ?? '';
  assertExactPaymentScope(paymentWhere, 'Recovery Checkout webhook payment predicate');
  assert.equal(updateCount(checkoutWebhook, 'paymentTransaction'), 2);
  assert.equal([...checkoutWebhook.matchAll(/where:\s*paymentWhere/g)].length, 2);

  const eventWhere = checkoutWebhook.match(/const eventWhere = \{[\s\S]*?\n    \};/)?.[0] ?? '';
  assertExactWebhookEventScope(eventWhere, 'Recovery Checkout webhook event predicate');
  assert.equal(updateCount(checkoutWebhook, 'paymentWebhookEvent'), 4);
  assert.equal([...checkoutWebhook.matchAll(/where:\s*eventWhere/g)].length, 4);
  assert.match(checkoutWebhook, /createHash\('sha256'\)/);
  assert.match(checkoutWebhook, /payloadHash/);
  assert.match(checkoutWebhook, /isolationLevel: 'Serializable'/);
});

test('signed direct recovery webhooks retain exact payment and verified ledger identity', () => {
  const paymentBlocks = mutationWhereBlocks(providerWebhook, 'paymentTransaction');
  assert.equal(paymentBlocks.length, 2);
  paymentBlocks.forEach((block, index) => assertExactPaymentScope(block, `Recovery provider webhook payment mutation ${index + 1}`));
  assert.match(paymentBlocks[0], /sourceProviderReference:\s*null/);
  assert.doesNotMatch(providerWebhook, /paymentTransaction\.update\(\{\s*where:\s*\{\s*id:\s*[^,}\n]+\s*\},/);

  const eventBlocks = mutationWhereBlocks(providerWebhook, 'paymentWebhookEvent');
  assert.equal(eventBlocks.length, 2);
  eventBlocks.forEach((block, index) => assertExactWebhookEventScope(block, `Recovery provider webhook event mutation ${index + 1}`));
  assert.doesNotMatch(providerWebhook, /paymentWebhookEvent\.update\(\{\s*where:\s*\{\s*id:\s*[^,}\n]+\s*\},/);
  assert.match(providerWebhook, /createHash\('sha256'\)/);
  assert.match(providerWebhook, /parseStripeWebhookEventPayload/);
  assert.match(providerWebhook, /processedAt:\s*input\.now/);
  assert.match(providerWebhook, /isolationLevel: 'Serializable'/);
});

test('documentation preserves recovery authority and validation boundaries', () => {
  const document = source('docs/stripe-commercial-amendment-recovery-write-scope.md');
  assert.match(document, /defense-in-depth persistence boundary/i);
  assert.match(document, /provider-specific calls remain behind the existing Stripe adapters/i);
  assert.match(document, /booking commercial snapshot is not rewritten by these persistence guards/i);
  assert.match(document, /verified webhook ledger identity/i);
  assert.match(document, /PostgreSQL/i);
  assert.match(document, /GitHub Actions are intentionally not used/i);
});
