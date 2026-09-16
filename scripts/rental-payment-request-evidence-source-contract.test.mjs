import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const domain = readFileSync('src/server/payments/rental-payment-domain.ts', 'utf8');
const service = readFileSync('src/server/payments/rental-payment-service.ts', 'utf8');
const migration = readFileSync('prisma/migrations/20260916153500_rental_payment_request_evidence/migration.sql', 'utf8');
const integration = readFileSync('src/server/payments/rental-payment.integration.ts', 'utf8');
const docs = readFileSync('docs/rental-payment-request-evidence.md', 'utf8');

test('rental payment request fingerprint binds exact tenant settlement authority', () => {
  assert.match(domain, /buildRentalPaymentRequestFingerprint/);
  assert.match(domain, /rental-payment-request-v1/);
  for (const token of [
    'input.organizationId',
    'input.bookingId',
    'input.idempotencyKey',
    'input.kind',
    'input.providerCode',
    'input.providerReference',
    "input.sourceProviderReference ?? ''",
    'input.currency',
    'input.amountMinor.toString()',
  ]) {
    assert.ok(domain.includes(token), `missing fingerprint authority token: ${token}`);
  }
  assert.match(domain, /createHash\('sha256'\)/);
});

test('manual payment and refund writers persist fingerprints and validate retained replay evidence', () => {
  assert.match(service, /buildRentalPaymentRequestFingerprint/);
  assert.match(service, /kind: 'OFFLINE_PAYMENT'/);
  assert.match(service, /kind: 'REFUND'/);
  assert.match(service, /requestFingerprint,/);
  assert.match(service, /existing\.requestFingerprint !== null && existing\.requestFingerprint !== expectedRequestFingerprint/);
  assert.match(service, /Manual payment provider result changed the durable rental payment request identity/);
  assert.match(service, /where: \{ id: input\.bookingId, organizationId: input\.organizationId \}/);
  assert.match(service, /isolationLevel: 'Serializable'/);
});

test('database requires request evidence shape, operation idempotency namespace, and database-authored creation time', () => {
  assert.match(migration, /sf_guard_rental_payment_request_evidence/);
  assert.match(migration, /NEW\."requestFingerprint" IS NULL/);
  assert.match(migration, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(migration, /\^rental:manual-payment:\[a-f0-9\]\{48\}\$/);
  assert.match(migration, /\^rental:manual-refund:\[a-f0-9\]\{48\}\$/);
  assert.match(migration, /NEW\."createdAt" IS DISTINCT FROM CURRENT_TIMESTAMP/);
  assert.match(migration, /rental_payment_transactions_authority_guard/);
});

test('guarded PostgreSQL scenario covers direct-write request-evidence rejection and persisted fingerprints', () => {
  assert.match(integration, /NO-FP-/);
  assert.match(integration, /request fingerprint/i);
  assert.match(integration, /BAD-KEY-/);
  assert.match(integration, /idempotency key/i);
  assert.match(integration, /BAD-TIME-/);
  assert.match(integration, /creation time/i);
  assert.match(integration, /payment\.transaction\.requestFingerprint/);
  assert.match(integration, /refund\.transaction\.requestFingerprint/);
});

test('documentation preserves legacy replay compatibility without expanding rental payment capability', () => {
  assert.match(docs, /Rows created before this migration may legitimately have `requestFingerprint = NULL`/);
  assert.match(docs, /New rows cannot use that legacy path/);
  assert.match(docs, /does not add Stripe rental checkout, deposits, split tenders/i);
  assert.match(docs, /GitHub Actions are not required or used/);
});
