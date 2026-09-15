import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Stripe payment reconciliation retains tenant, provider, lifecycle, and money scope at final writes', () => {
  const service = source('src/server/payments/stripe-reconciliation-service.ts');

  assert.match(
    service,
    /paymentTransaction\.update\(\{\s*where: \{\s*id: current\.id,\s*organizationId: input\.organizationId,\s*bookingId: payment\.bookingId,\s*providerCode: STRIPE_PROVIDER_CODE,\s*kind: payment\.kind,\s*status: 'PENDING',\s*providerReference: payment\.providerReference,\s*currency: payment\.currency,\s*amountMinor: payment\.amountMinor,/,
  );
  assert.match(
    service,
    /hospitalityBooking\.update\(\{\s*where: \{\s*id: booking\.id,\s*organizationId: input\.organizationId,\s*status: 'CONFIRMED',\s*paymentStatus: booking\.paymentStatus,\s*currency: payment\.currency,\s*totalMinor: payment\.amountMinor,/,
  );
  assert.doesNotMatch(service, /paymentTransaction\.update\(\{\s*where: \{ id: current\.id \}/);
  assert.doesNotMatch(service, /hospitalityBooking\.update\(\{\s*where: \{ id: booking\.id \}/);
  assert.match(service, /permission: 'payment:manage'/);
  assert.match(service, /isolationLevel: 'Serializable'/);
});

test('Stripe refund reconciliation retains settlement-source and booking scope at final writes', () => {
  const service = source('src/server/payments/stripe-refund-reconciliation-service.ts');

  assert.match(
    service,
    /paymentTransaction\.update\(\{\s*where: \{\s*id: current\.id,\s*organizationId: input\.organizationId,\s*bookingId: refund\.bookingId,\s*providerCode: STRIPE_PROVIDER_CODE,\s*kind: 'REFUND',\s*status: 'PENDING',\s*providerReference: refund\.providerReference,\s*sourceProviderReference: refund\.sourceProviderReference,\s*currency: refund\.currency,\s*amountMinor: refund\.amountMinor,/,
  );
  assert.match(
    service,
    /hospitalityBooking\.update\(\{\s*where: \{\s*id: currentBooking\.id,\s*organizationId: input\.organizationId,\s*status: 'CONFIRMED',\s*paymentStatus: currentBooking\.paymentStatus,\s*currency: currentBooking\.currency,\s*totalMinor: currentBooking\.totalMinor,/,
  );
  assert.doesNotMatch(service, /paymentTransaction\.update\(\{\s*where: \{ id: current\.id \}/);
  assert.doesNotMatch(service, /hospitalityBooking\.update\(\{\s*where: \{ id: currentBooking\.id \}/);
  assert.match(service, /permission: 'payment:manage'/);
  assert.match(service, /hospitalityBookingMutationLockKey/);
  assert.match(service, /isolationLevel: 'Serializable'/);
});

test('Stripe reconciliation write-scope documentation keeps the production boundary explicit', () => {
  const document = source('docs/stripe-reconciliation-write-scope.md');
  const tenancy = source('docs/tenant-system.md');

  assert.match(document, /provider reconciliation as a commercial state transition/i);
  assert.match(document, /exact integer-minor currency\/amount evidence/i);
  assert.match(document, /defense in depth/i);
  assert.match(document, /signed Stripe webhook state machine/i);
  assert.match(document, /GitHub Actions are intentionally not used/i);
  assert.match(tenancy, /Stripe payment\/refund reconciliation/i);
  assert.match(tenancy, /stripe-reconciliation-write-scope\.md/);
});
