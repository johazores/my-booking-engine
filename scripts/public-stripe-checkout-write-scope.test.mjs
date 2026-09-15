import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const checkout = source('src/server/payments/public-stripe-checkout-service.ts');
const status = source('src/server/payments/public-stripe-payment-status-service.ts');

test('public Checkout failure mutation retains tenant, provider, lifecycle, and money scope', () => {
  assert.doesNotMatch(checkout, /paymentTransaction\.update\(\{\s*where: \{ id:/);
  assert.match(checkout, /paymentTransaction\.update\(\{\s*where: \{\s*id: payment\.id,\s*organizationId: input\.organizationId,\s*bookingId: input\.bookingId,\s*providerCode: STRIPE_PROVIDER_CODE,\s*kind: 'CAPTURE',\s*status: 'PENDING',\s*providerReference: payment\.providerReference,\s*currency: payment\.currency,\s*amountMinor: payment\.amountMinor,\s*requestFingerprint: payment\.requestFingerprint,/);
  assert.match(checkout, /hospitalityBooking\.updateMany\(\{\s*where: \{\s*id: input\.bookingId,\s*organizationId: input\.organizationId,\s*status: \{ in: \['PENDING_CONFIRMATION', 'CONFIRMED'\] \},\s*paymentStatus: \{ in: \['UNPAID', 'FAILED'\] \},\s*currency: payment\.currency,\s*totalMinor: payment\.amountMinor,/);
  assert.match(checkout, /isInternalPaymentClaimReference\(payment\.providerReference\)/);
});

test('provider-session binding requires the exact still-pending internal claim', () => {
  assert.match(checkout, /payment\.status !== 'PENDING'[\s\S]*payment\.providerReference !== paymentOperationClaimReference\(input\.requestFingerprint\)/);
  assert.match(checkout, /Checkout payment claim is no longer pending provider binding\./);
  assert.match(checkout, /organizationId_paymentTransactionId/);
  assert.match(checkout, /organizationId_providerCode_providerReference/);
});

test('pending booking promotion retains lifecycle and exact commercial money', () => {
  assert.match(checkout, /hospitalityBooking\.updateMany\(\{\s*where: \{\s*id: input\.bookingId,\s*organizationId: input\.organizationId,\s*status: 'PENDING_CONFIRMATION',\s*paymentStatus: \{ in: \['UNPAID', 'FAILED'\] \},\s*currency: payment\.currency,\s*totalMinor: payment\.amountMinor,/);
  assert.match(checkout, /pg_advisory_xact_lock/);
  assert.match(checkout, /isolationLevel: 'Serializable'/);
});

test('adjacent public status remains read-only and documentation states the trust boundary', () => {
  assert.doesNotMatch(status, /\.(?:create|update|updateMany|delete|deleteMany|upsert)\(/);

  const document = source('docs/public-stripe-checkout-write-scope.md');
  assert.match(document, /capability-owned payment start boundary/i);
  assert.match(document, /browser redirects authoritative/i);
  assert.match(document, /defense in depth/i);
  assert.match(document, /adjacent public payment-status reader.*read-only/i);
  assert.match(document, /GitHub Actions are intentionally not used/i);
});
