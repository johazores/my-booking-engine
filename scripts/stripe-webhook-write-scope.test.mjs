import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const service = source('src/server/payments/stripe-webhook-service.ts');

test('signed Stripe webhook mutations retain tenant and commercial state scope', () => {
  assert.doesNotMatch(service, /paymentTransaction\.update\(\{\s*where: \{ id:/);
  assert.doesNotMatch(service, /hospitalityBooking\.update\(\{\s*where: \{ id:/);
  assert.doesNotMatch(service, /paymentCheckoutSession\.update\(\{\s*where: \{ id:/);

  assert.match(service, /paymentTransaction\.update\(\{\s*where: \{\s*id: payment\.id,\s*organizationId: input\.organizationId,\s*bookingId: booking\.id,\s*providerCode: STRIPE_PROVIDER_CODE,\s*kind: 'CAPTURE',\s*status: payment\.status,\s*providerReference: payment\.providerReference,\s*currency: payment\.currency,\s*amountMinor: payment\.amountMinor,/);
  assert.match(service, /paymentTransaction\.update\(\{\s*where: \{\s*id: refund\.id,\s*organizationId: input\.organizationId,\s*bookingId: booking\.id,\s*providerCode: STRIPE_PROVIDER_CODE,\s*kind: 'REFUND',\s*status: 'PENDING',\s*providerReference: currentRefund\.providerReference,\s*sourceProviderReference: currentRefund\.sourceProviderReference,\s*currency: currentRefund\.currency,\s*amountMinor: currentRefund\.amountMinor,/);
  assert.match(service, /paymentTransaction\.update\(\{\s*where: \{\s*id: current\.id,\s*organizationId: input\.organizationId,\s*bookingId: booking\.id,\s*providerCode: STRIPE_PROVIDER_CODE,\s*kind: payment\.kind,\s*status: 'PENDING',\s*providerReference: current\.providerReference,\s*currency: current\.currency,\s*amountMinor: current\.amountMinor,/);
});

test('Checkout session and booking mutations retain the validated lifecycle', () => {
  const sessionUpdates = service.match(/paymentCheckoutSession\.update\(\{/g) ?? [];
  assert.equal(sessionUpdates.length, 3);
  assert.equal((service.match(/paymentTransactionId: payment\.id/g) ?? []).length >= 3, true);
  assert.equal((service.match(/providerReference: currentSession\.providerReference/g) ?? []).length >= 3, true);
  assert.equal((service.match(/status: 'OPEN'/g) ?? []).length >= 3, true);

  assert.match(service, /id: booking\.id,\s*organizationId: input\.organizationId,\s*status: 'CONFIRMED',\s*paymentStatus: booking\.paymentStatus,\s*currency: booking\.currency,\s*totalMinor: booking\.totalMinor,/);
  assert.match(service, /id: booking\.id,\s*organizationId: input\.organizationId,\s*status: lockedBooking\.status,\s*paymentStatus: lockedBooking\.paymentStatus,\s*currency: booking\.currency,\s*totalMinor: booking\.totalMinor,/);
  assert.match(service, /status: lockedPayment\.status,\s*providerReference: lockedPayment\.providerReference/);
});

test('tracked booking Checkout callbacks revalidate created-session authority before commercial writes', () => {
  const domain = source('src/server/payments/stripe-webhook-domain.ts');
  const normalCommercial = source('src/server/bookings/booking-commercial-amendment-stripe-checkout-webhook-domain.ts');
  const recoveryCommercial = source('src/server/bookings/booking-commercial-amendment-stripe-recovery-checkout-webhook-domain.ts');

  assert.match(service, /inspectStripeBookingCheckoutAuthority\(\{\s*checkoutSession: event\.checkoutSession,\s*bookingId: tracked\.bookingId,\s*expiresAt: currentSession\.expiresAt,/);
  const authorityIndex = service.indexOf('inspectStripeBookingCheckoutAuthority({');
  const moneyIndex = service.indexOf('checkout-session-booking-money-mismatch');
  const completionIndex = service.indexOf("event.eventType === 'checkout.session.completed'");
  assert.ok(authorityIndex >= 0 && moneyIndex > authorityIndex && completionIndex > moneyIndex);

  assert.match(domain, /checkoutSession\.mode !== 'payment'/);
  assert.match(domain, /checkoutSession\.clientReferenceId !== input\.bookingId\.toLowerCase\(\)/);
  assert.match(domain, /checkoutSession\.commercialContext !== null/);
  assert.match(domain, /checkoutSession\.expiresAt\.getTime\(\) !== input\.expiresAt\.getTime\(\)/);
  assert.match(domain, /Object\.prototype\.hasOwnProperty\.call\(metadata, 'sf_checkout_purpose'\)/);

  for (const commercial of [normalCommercial, recoveryCommercial]) {
    assert.match(commercial, /checkout\.mode !== 'payment'/);
    assert.match(commercial, /checkout\.clientReferenceId !== checkout\.bookingId/);
    assert.match(commercial, /!checkout\.expiresAt/);
    assert.match(commercial, /checkout\.commercialContext/);
    assert.doesNotMatch(commercial, /JSON\.parse\(payload\)/);
  }
});

test('webhook trust, idempotency, locking, and documentation boundaries remain explicit', () => {
  const verificationIndex = service.indexOf('verifyWebhookSignature');
  const transactionIndex = service.indexOf('return db.$transaction');
  assert.ok(verificationIndex >= 0 && transactionIndex > verificationIndex);
  assert.match(service, /payloadHash = createHash\('sha256'\)/);
  assert.match(service, /providerEventId: event\.providerEventId/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /isolationLevel: 'Serializable'/);

  const document = source('docs/stripe-webhook-write-scope.md');
  const tenancy = source('docs/tenant-system.md');
  assert.match(document, /signature.*raw payload/i);
  assert.match(document, /provider event id/i);
  assert.match(document, /defense in depth/i);
  assert.match(document, /commercial-amendment webhook/i);
  assert.match(document, /mode.*client_reference_id.*expires_at/is);
  assert.match(document, /GitHub Actions are intentionally not used/i);
  assert.match(tenancy, /core signed Stripe webhook/i);
  assert.match(tenancy, /stripe-webhook-write-scope\.md/);
});
