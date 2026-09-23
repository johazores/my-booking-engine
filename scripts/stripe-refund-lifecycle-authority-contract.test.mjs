import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/webhooks/stripe/[organization-id]/route.ts', import.meta.url), 'utf8');
const lifecycle = readFileSync(new URL('../src/server/payments/stripe-refund-lifecycle-service.ts', import.meta.url), 'utf8');
const reconciliation = readFileSync(new URL('../src/server/payments/stripe-refund-reconciliation-service.ts', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../docs/stripe-refund-lifecycle-authority.md', import.meta.url), 'utf8');

test('verified webhook routing reconciles exact refund provider truth before specialized finalizers', () => {
  const ingestIndex = route.indexOf('await ingestStripePaymentWebhook({');
  const refundIndex = route.indexOf('await reconcileVerifiedStripeRefundWebhook({');
  const amendmentIndex = route.indexOf('await finalizeVerifiedStripeCommercialAmendmentCheckoutWebhook({');
  assert.ok(ingestIndex >= 0, 'signed Stripe ingestion must remain present');
  assert.ok(refundIndex > ingestIndex, 'refund lifecycle reconciliation must follow verified ingestion');
  assert.ok(amendmentIndex > refundIndex, 'specialized amendment finalization must follow generic exact-refund reconciliation');
});

test('refund lifecycle authority is exact, tenant scoped, provider current, and amendment isolated', () => {
  assert.match(lifecycle, /paymentWebhookEvent\.findFirst\([\s\S]*organizationId: input\.organizationId[\s\S]*providerEventId: event\.providerEventId/);
  assert.match(lifecycle, /verifiedEvent\.payloadHash !== payloadHash/);
  assert.match(lifecycle, /commercialAmendmentId: null,[\s\S]*providerReference: event\.refund\.refundReference/);
  assert.match(lifecycle, /refundReconciliationProvider\.retrieveRefund\(refund\.providerReference\)/);
  assert.match(lifecycle, /baselineTransactions = ledger\.filter\(\(entry\) => entry\.id !== current\.id\)/);
  assert.match(lifecycle, /bookingPaymentStatusForRefundLifecycle\(/);
  assert.match(lifecycle, /status: current\.status,[\s\S]*providerReference: current\.providerReference,[\s\S]*sourceProviderReference: current\.sourceProviderReference/);
});

test('explicit reconciliation supports post-success provider truth without crossing amendment ownership', () => {
  assert.doesNotMatch(reconciliation, /if \(refund\.status !== 'PENDING'\) return refund/);
  assert.doesNotMatch(reconciliation, /if \(refund\.status === 'FAILED'\) return refund/);
  assert.doesNotMatch(reconciliation, /if \(current\.status === 'FAILED'\) return current/);
  assert.match(reconciliation, /if \(refund\.commercialAmendmentId !== null\)/);
  assert.match(reconciliation, /baselineTransactions = ledger\.filter\(\(transaction\) => transaction\.id !== refund\.id\)/);
  assert.match(reconciliation, /bookingPaymentStatusForRefundLifecycle\(/);
  assert.match(reconciliation, /commercialAmendmentId: null,[\s\S]*status: current\.status/);
  assert.match(reconciliation, /previousStatus: current\.status/);
  assert.match(reconciliation, /changed: decision\.action === 'MUTATE'/);
});

test('documentation records non-terminal Stripe success and provider-truth recovery', () => {
  assert.match(docs, /refund success is not universally terminal/i);
  assert.match(docs, /succeeded.*requires_action/is);
  assert.match(docs, /retrieves the current Refund object/i);
  assert.match(docs, /commercialAmendmentId = null/);
  assert.match(docs, /excluding the refund currently being reconciled/i);
  assert.match(docs, /docs\.stripe\.com\/refunds#failed-refunds/);
  assert.match(docs, /docs\.stripe\.com\/refunds#requires-action/);
});
