import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const payments = source('src/server/payments/stripe-payment-service.ts');
const refunds = source('src/server/payments/stripe-refund-service.ts');

test('authorization and capture persistence retain tenant and commercial state scope', () => {
  assert.doesNotMatch(payments, /paymentTransaction\.update\(\{\s*where: \{ id:/);
  assert.doesNotMatch(payments, /hospitalityBooking\.update\(\{\s*where: \{ id:/);

  assert.match(payments, /providerCode: STRIPE_PROVIDER_CODE,\s*kind: 'AUTHORIZATION',\s*status: existing\.status,\s*providerReference: existing\.providerReference,\s*currency: existing\.currency,\s*amountMinor: existing\.amountMinor,\s*requestFingerprint: existing\.requestFingerprint,/);
  assert.match(payments, /providerCode: STRIPE_PROVIDER_CODE,\s*kind: 'CAPTURE',\s*status: existing\.status,\s*providerReference: existing\.providerReference,\s*currency: existing\.currency,\s*amountMinor: existing\.amountMinor,\s*requestFingerprint: existing\.requestFingerprint,/);
  assert.match(payments, /status: 'CONFIRMED',\s*paymentStatus: currentBooking\.paymentStatus,\s*currency: currentBooking\.currency,\s*totalMinor: currentBooking\.totalMinor,/);
});

test('provider failure cleanup remains scoped to the exact internal claim', () => {
  assert.match(payments, /payment\.kind !== input\.kind/);
  assert.match(payments, /payment\.providerCode !== STRIPE_PROVIDER_CODE/);
  assert.match(payments, /isInternalPaymentClaimReference\(payment\.providerReference\)/);
  assert.match(payments, /kind: input\.kind,\s*status: 'PENDING',\s*providerReference: payment\.providerReference,\s*currency: payment\.currency,\s*amountMinor: payment\.amountMinor,\s*requestFingerprint: payment\.requestFingerprint,/);
});

test('refund persistence retains tenant, source, lifecycle, and exact money scope', () => {
  assert.doesNotMatch(refunds, /paymentTransaction\.update\(\{\s*where: \{ id:/);
  assert.doesNotMatch(refunds, /hospitalityBooking\.update\(\{\s*where: \{ id:/);

  assert.match(refunds, /providerCode: PROVIDER,\s*kind: 'REFUND',\s*status: existing\.status,\s*providerReference: existing\.providerReference,\s*sourceProviderReference: existing\.sourceProviderReference,\s*currency: existing\.currency,\s*amountMinor: existing\.amountMinor,\s*requestFingerprint: existing\.requestFingerprint,/);
  assert.match(refunds, /providerCode: PROVIDER,\s*kind: 'REFUND',\s*status: 'PENDING',\s*providerReference: refund\.providerReference,\s*sourceProviderReference: refund\.sourceProviderReference,\s*currency: refund\.currency,\s*amountMinor: refund\.amountMinor,\s*requestFingerprint: refund\.requestFingerprint,/);
  assert.match(refunds, /status: 'CONFIRMED',\s*paymentStatus: currentBooking\.paymentStatus,\s*currency: currentBooking\.currency,\s*totalMinor: currentBooking\.totalMinor,/);
});

test('authorization, locking, provider, and documentation boundaries remain explicit', () => {
  assert.match(payments, /permission: 'payment:manage'/);
  assert.match(refunds, /permission: 'payment:manage'/);
  assert.match(payments, /loadStripePaymentIntegration/);
  assert.match(refunds, /loadStripePaymentIntegration/);
  assert.match(payments, /pg_advisory_xact_lock/);
  assert.match(refunds, /pg_advisory_xact_lock/);
  assert.match(payments, /isolationLevel: 'Serializable'/);
  assert.match(refunds, /isolationLevel: 'Serializable'/);

  const document = source('docs/stripe-payment-initiation-write-scope.md');
  const tenancy = source('docs/tenant-system.md');
  assert.match(document, /staff-authorized commercial boundary/i);
  assert.match(document, /defense in depth/i);
  assert.match(document, /commercial-amendment.*outside this focused review/i);
  assert.match(document, /GitHub Actions are intentionally not used/i);
  assert.match(tenancy, /authenticated Stripe payment\/refund initiation/i);
  assert.match(tenancy, /stripe-payment-initiation-write-scope\.md/);
});
