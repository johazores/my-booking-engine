import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/webhooks/stripe/[organization-id]/route.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/server/bookings/hospitality-booking-commercial-amendment-stripe-refund-lifecycle-service.ts', import.meta.url), 'utf8');
const domain = readFileSync(new URL('../src/server/bookings/booking-commercial-amendment-stripe-refund-domain.ts', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../docs/stripe-refund-lifecycle-authority.md', import.meta.url), 'utf8');
const refundDocs = readFileSync(new URL('../docs/stripe-refunds.md', import.meta.url), 'utf8');

test('verified route reconciles current amendment refund truth before legacy commercial finalizers', () => {
  const normalIndex = route.indexOf('await reconcileVerifiedStripeRefundWebhook({');
  const amendmentIndex = route.indexOf('await reconcileVerifiedStripeCommercialAmendmentRefundWebhook({');
  const checkoutIndex = route.indexOf('await finalizeVerifiedStripeCommercialAmendmentCheckoutWebhook({');
  const legacyIndex = route.indexOf('await finalizeVerifiedStripeCommercialAmendmentWebhook({');
  assert.ok(normalIndex >= 0 && amendmentIndex > normalIndex);
  assert.ok(checkoutIndex > amendmentIndex && legacyIndex > amendmentIndex);
  assert.match(route, /if \(amendmentRefundLifecycle\.handled\) \{[\s\S]*?return finish\(Response\.json\(\{ received: true \}\)\);/);
});

test('amendment lifecycle requires verified exact ownership then retrieves current Stripe truth', () => {
  assert.match(service, /verifiedEvent\.providerReference !== event\.refund\.refundReference/);
  assert.match(service, /commercialAmendmentId: \{ not: null \}/);
  assert.match(service, /providerReference: event\.refund\.refundReference/);
  assert.match(service, /refund\.sourceProviderReference !== event\.refund\.paymentIntentReference/);
  assert.match(service, /refund\.requestFingerprint !== expectedFingerprint/);
  assert.match(service, /refundReconciliationProvider\.retrieveRefund\(refund\.providerReference\)/);
  assert.match(service, /snapshot\.refundReference !== refund\.providerReference/);
});

test('final write is tenant booking amendment source money and current-status scoped without booking mutation', () => {
  assert.match(service, /commercialAmendmentId: refund\.commercialAmendmentId/);
  assert.match(service, /status: current\.status/);
  assert.match(service, /providerReference: current\.providerReference/);
  assert.match(service, /sourceProviderReference: current\.sourceProviderReference/);
  assert.match(service, /currency: current\.currency/);
  assert.match(service, /amountMinor: current\.amountMinor/);
  assert.match(service, /processingNote: decision\.processingNote/);
  assert.doesNotMatch(service, /hospitalityBooking\.update\(/);
  assert.doesNotMatch(service, /hospitalityBookingCommercialAmendment\.update\(/);
});

test('lifecycle leaves compensation-refund ownership to the recovery finalizer', () => {
  assert.match(service, /if \(amendment\.direction !== 'REFUND'\) \{[\s\S]*?handled: false as const/);
  assert.match(docs, /commercial-amendment refund money remains amendment-owned/i);
});

test('domain and docs record that amendment refund success is not terminal', () => {
  assert.match(domain, /currentStatus: StripeCommercialAmendmentRefundTransactionStatus/);
  assert.match(domain, /providerStatus: StripeCommercialAmendmentRefundProviderStatus/);
  assert.match(domain, /action: 'MUTATE'/);
  assert.match(docs, /SUCCEEDED.*not terminal/s);
  assert.match(docs, /does \*\*not\*\* rewrite booking totals, booking payment status, amendment pricing/);
  assert.match(docs, /current tenant-owned Stripe Refund retrieval is settlement authority/);
  assert.match(refundDocs, /Commercial-amendment refund success is not treated as terminal/);
  assert.match(refundDocs, /does not rewrite booking totals, booking payment status, amendment pricing/);
});
