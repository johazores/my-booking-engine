import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const authenticatedPaymentRoutes = [
  ['app/api/payments/manual/route.ts', 'payment.manual.record', 'manual'],
  ['app/api/payments/manual/refunds/route.ts', 'payment.manual-refund.record', 'manual'],
  ['app/api/payments/stripe/reconcile/route.ts', 'payment.stripe.reconcile', 'stripe'],
  ['app/api/payments/stripe/refunds/route.ts', 'payment.stripe-refund.create', 'stripe'],
  ['app/api/payments/stripe/refunds/reconcile/route.ts', 'payment.stripe-refund.reconcile', 'stripe'],
];

const authenticatedReadRoutes = [
  ['app/api/payments/receipt/route.ts', 'payment.receipt.read'],
  ['app/api/payments/transactions/route.ts', 'payment.transactions.read'],
];

const commercialAmendmentPaymentRoutes = [
  ['app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/manual-settlement/route.ts', 'payment.commercial-amendment.manual-settlement', 'manual'],
  ['app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/stripe-checkout/route.ts', 'payment.commercial-amendment.stripe-checkout.create', 'stripe'],
  ['app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/stripe-checkout/status/route.ts', 'payment.commercial-amendment.stripe-checkout.reconcile', 'stripe'],
  ['app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/stripe-refund/route.ts', 'payment.commercial-amendment.stripe-refund.create', 'stripe'],
  ['app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/stripe-refund/status/route.ts', 'payment.commercial-amendment.stripe-refund.reconcile', 'stripe'],
  ['app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/recovery/stripe-checkout/route.ts', 'payment.commercial-amendment.stripe-recovery-checkout.create', 'stripe'],
  ['app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/recovery/stripe-checkout/status/route.ts', 'payment.commercial-amendment.stripe-recovery-checkout.reconcile', 'stripe'],
];

const publicStripeRoutes = [
  ['app/api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout/route.ts', 'public-payment.stripe-checkout.create'],
  ['app/api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout/status/route.ts', 'public-payment.stripe-checkout.status'],
];

function assertObserved(source, operation) {
  assert.match(source, /createRequestObservation\(request, \{ operation: '[^']+' \}\)/);
  assert.match(source, new RegExp(operation.replaceAll('.', '\\.')));
  assert.match(source, /observation\.finish\(/);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)/);
}

test('authenticated payment writes log tenant context only after payment API authorization', () => {
  for (const [path, operation, provider] of authenticatedPaymentRoutes) {
    const source = route(path);
    assertObserved(source, operation);
    assert.match(source, new RegExp(`provider: '${provider}'`));
    const contextIndex = source.indexOf('await requirePaymentApiContext(request');
    const tenantScopeIndex = source.indexOf('organizationId = context.organizationId;');
    assert.ok(contextIndex >= 0, `${path} must require payment API context`);
    assert.ok(tenantScopeIndex > contextIndex, `${path} must not attach tenant log scope before authorization`);
    assert.match(source, /if \(context\.response\) return finish\(context\.response\);/);
    assert.match(source, /catch \(error\) \{\n\s+return finish\(paymentApiError\(error\)\);/);
    assert.doesNotMatch(source, /observation\.finish\(.*(?:bookingId|transactionId|idempotencyKey|reference|request\.url)/);
  }
});

test('authenticated payment reads correlate responses without logging query selectors', () => {
  for (const [path, operation] of authenticatedReadRoutes) {
    const source = route(path);
    assertObserved(source, operation);
    const contextIndex = source.indexOf('await requirePaymentApiContext(request');
    const tenantScopeIndex = source.indexOf('organizationId = context.organizationId;');
    assert.ok(tenantScopeIndex > contextIndex, `${path} must establish authenticated tenant scope first`);
    assert.match(source, /const url = new URL\(request\.url\);/);
    assert.doesNotMatch(source, /observation\.finish\([^\n]+(?:bookingId|pageSize|searchParams|request\.url)/);
  }
});

test('commercial amendment payment routes correlate only after hospitality tenant authorization', () => {
  for (const [path, operation, provider] of commercialAmendmentPaymentRoutes) {
    const source = route(path);
    assertObserved(source, operation);
    assert.match(source, new RegExp(`provider: '${provider}'`));
    const contextIndex = Math.max(
      source.indexOf('await requireHospitalityBookingApiContext(request'),
      source.indexOf('await requireHospitalityBookingApiContext(request,'),
    );
    const authTenantIndex = source.indexOf('organizationId = auth.organizationId;');
    const contextTenantIndex = source.indexOf('organizationId = context.organizationId;');
    const tenantScopeIndex = Math.max(authTenantIndex, contextTenantIndex);
    assert.ok(contextIndex >= 0, `${path} must require hospitality booking API context`);
    assert.ok(tenantScopeIndex > contextIndex, `${path} must not attach tenant log scope before authorization`);
    assert.match(source, /if \((?:auth|context)\.response\) return finish\((?:auth|context)\.response\);/);
    assert.match(source, /catch \(error\) \{\n\s+return finish\(hospitalityBookingApiError\(error\)\);/);
    assert.doesNotMatch(source, /observation\.finish\(.*(?:bookingId|amendmentId|idempotencyKey|externalReference|request\.url)/);
  }
});

test('public Stripe payment routes correlate safely without logging capability or route selectors', () => {
  for (const [path, operation] of publicStripeRoutes) {
    const source = route(path);
    assertObserved(source, operation);
    assert.match(source, /observation\.finish\(response, \{ provider: 'stripe' \}\)/);
    assert.doesNotMatch(source, /observation\.finish\([^\n]+(?:organizationSlug|bookingCapability|requestKey|request\.url)/);
    assert.doesNotMatch(source, /organizationId:/);
    assert.doesNotMatch(source, /bookingReference:/);
  }
});

test('Stripe webhook exposes tenant log scope only after verified webhook ingestion', () => {
  const source = route('app/api/webhooks/stripe/[organization-id]/route.ts');
  assertObserved(source, 'payment.stripe-webhook.ingest');
  assert.match(source, /provider: 'stripe'/);
  const verificationIndex = source.indexOf('await ingestStripePaymentWebhook({');
  const tenantScopeIndex = source.indexOf('verifiedOrganizationId = organizationId;');
  assert.ok(verificationIndex >= 0);
  assert.ok(tenantScopeIndex > verificationIndex, 'webhook tenant log scope must follow verified Stripe ingestion');
  assert.doesNotMatch(source.slice(0, tenantScopeIndex), /verifiedOrganizationId = organizationId;/);
  assert.doesNotMatch(source, /observation\.finish\([^\n]+(?:payload|stripe-signature|request\.headers|request\.url)/);
});
