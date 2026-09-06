import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('stale supplier reservation recovery has a fixed conservative execution lease', () => {
  const lease = source('src/server/suppliers/hospitality-supplier-reservation-attempt-lease.ts');
  assert.match(lease, /ATTEMPT_LEASE_MS\s*=\s*10\s*\*\s*60_000/);
  assert.match(lease, /status === 'SUBMITTING' \? 'CREATE' : 'RECONCILE'/);
  assert.match(lease, /attemptStatus !== 'STARTED'/);
  assert.match(lease, /attemptSequence !== input\.currentAttemptCount/);
  assert.match(lease, /elapsedMs < HOSPITALITY_SUPPLIER_RESERVATION_ATTEMPT_LEASE_MS/);
});

test('stale recovery authorizes first, scopes every database read, and preserves the shared operation lock', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-attempt-recovery-service.ts');
  const authorityIndex = service.indexOf('await requireSupplierReservationRecoveryAuthority');
  const transactionIndex = service.indexOf('return db.$transaction');
  assert.ok(authorityIndex >= 0 && transactionIndex > authorityIndex);
  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /id: input\.reservationId,[\s\S]*?organizationId: input\.organizationId/);
  assert.match(service, /organizationId: input\.organizationId,[\s\S]*?reservationId: reservation\.id,[\s\S]*?sequence: reservation\.attemptCount,[\s\S]*?status: 'STARTED'/);
  assert.match(service, /supplier-reservation:\$\{organizationId\}:operation:\$\{reservationId\}/);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(service, /SELECT clock_timestamp\(\) AS \"currentTime\"/);
});

test('expired in-flight claims become ambiguous rather than safe-to-retry', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-attempt-recovery-service.ts');
  assert.match(service, /reservation\.status !== 'SUBMITTING' && reservation\.status !== 'RECONCILING'/);
  assert.match(service, /status: 'AMBIGUOUS'/);
  assert.match(service, /EXECUTION_LEASE_EXPIRED/);
  assert.doesNotMatch(service, /status: 'PREPARED'/);
  assert.match(service, /attempt\.kind === 'CREATE'[\s\S]*?submission-lease-expired[\s\S]*?reconciliation-lease-expired/);
});

test('recovery audit stays privacy-minimal and disposable database coverage is registered', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-attempt-recovery-service.ts');
  const runner = source('scripts/run-database-tests.mjs');
  const auditBlocks = [...service.matchAll(/afterData: \{([\s\S]*?)\n        \},/g)].map((match) => match[1]).join('\n');
  assert.doesNotMatch(auditBlocks, /supplierPropertyReference|supplierOfferReference|providerReservationReference|providerCorrelation|reservationPayloadFingerprint/);
  assert.doesNotMatch(service, /encryptedCredentials|accessToken|requestPayload|responseBody|cardNumber|cvv/i);
  assert.match(runner, /hospitality-supplier-reservation-attempt-recovery\.integration\.ts/);
});
