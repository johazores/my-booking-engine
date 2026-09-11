import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Travelport payment-card source bounds durable context and sanitizes external failures', () => {
  const boundary = source('src/server/suppliers/travelport-stays-reservation-payment-card-source.ts');
  assert.match(boundary, /MAX_INTEGRATION_CREDENTIAL_VERSION = 2_147_483_647/);
  assert.match(boundary, /Number\.isSafeInteger\(normalizedContext\.integrationCredentialVersion\)/);
  assert.match(boundary, /function sourceFailure\(error: unknown\): never/);
  assert.match(boundary, /hospitalitySupplierFailureCodes\.includes\(error\.code\)/);
  assert.match(boundary, /Source-controlled thrown values can themselves be hostile proxies/);
  assert.match(boundary, /new HospitalitySupplierProviderError\(code, SOURCE_FAILURE_MESSAGE\)/);
  assert.match(boundary, /acquirePaymentCard = source\.acquirePaymentCard/);
  assert.match(boundary, /acquirePaymentCard\.call\(source, normalizedContext\)/);
  assert.doesNotMatch(boundary, /throw error;/);
});

test('Travelport payment-card source materializes a bounded one-read allowlisted snapshot', () => {
  const boundary = source('src/server/suppliers/travelport-stays-reservation-payment-card-source.ts');
  assert.match(boundary, /function snapshotPaymentCard\(value: unknown\)/);
  assert.match(boundary, /const BILLING_ADDRESS_KEYS = Object\.freeze/);
  assert.match(boundary, /const TELEPHONE_KEYS = Object\.freeze/);
  assert.match(boundary, /cardNumber = paymentCard\.cardNumber/);
  assert.match(boundary, /securityCode = paymentCard\.securityCode/);
  assert.match(boundary, /return Object\.freeze\(\{/);
  assert.match(boundary, /return snapshotPaymentCard\(paymentCard\)/);
  assert.doesNotMatch(boundary, /return paymentCard;/);
});

test('Travelport create executor regression fixture uses deferred payment-card acquisition', () => {
  const fixture = source('src/server/suppliers/travelport-stays-reservation-create-executor.test.ts');
  const createCalls = fixture.match(/executor\.createReservation\(\{/g) ?? [];
  const deferredSources = fixture.match(/acquirePaymentCard: async \(\) =>/g) ?? [];
  assert.ok(createCalls.length >= 1);
  assert.equal(deferredSources.length, createCalls.length);
  assert.doesNotMatch(fixture, /executor\.createReservation\(\{[\s\S]{0,500}\bpaymentCard,\s*\n\s*expectedReservation/);
  assert.match(fixture, /\['token', 'card', 'marker', 'create'\]/);
});

test('payment-card boundary documentation keeps production activation closed', () => {
  const doc = source('docs/travelport-reservation-payment-card-boundary.md');
  assert.match(doc, /PCI/i);
  assert.match(doc, /reservation.*disabled/i);
  assert.match(doc, /sanit/i);
  assert.match(doc, /allowlist/i);
  assert.match(doc, /read exactly once/i);
  assert.match(doc, /2,147,483,647/);
  assert.match(doc, /does not provide a concrete production/i);
});
