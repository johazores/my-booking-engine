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

test('lease age and provider-request evidence use database-authored clocks', () => {
  const schema = source('prisma/hospitality-supplier-reservations.prisma');
  const leaseMigration = source('prisma/migrations/20260906094000_supplier-reservation-db-lease-clock/migration.sql');
  const providerBoundaryMigration = source('prisma/migrations/20260906122500_supplier-reservation-provider-request-boundary/migration.sql');
  const service = source('src/server/suppliers/hospitality-supplier-reservation-attempt-recovery-service.ts');

  assert.match(schema, /leaseStartedAt\s+DateTime\?\s+@default\(dbgenerated\("clock_timestamp\(\)"\)\)\s+@db\.Timestamptz\(6\)/);
  assert.match(schema, /providerRequestStartedAt\s+DateTime\?\s+@db\.Timestamptz\(6\)/);
  assert.match(leaseMigration, /ADD COLUMN "leaseStartedAt" TIMESTAMPTZ\(6\)/);
  assert.match(leaseMigration, /SET "leaseStartedAt" = clock_timestamp\(\)[\s\S]*?WHERE "status" = 'STARTED'/);
  assert.match(leaseMigration, /ALTER COLUMN "leaseStartedAt" SET DEFAULT clock_timestamp\(\)/);
  assert.match(leaseMigration, /CHECK \("status" <> 'STARTED' OR "leaseStartedAt" IS NOT NULL\)/);
  assert.match(providerBoundaryMigration, /ADD COLUMN "providerRequestStartedAt" TIMESTAMPTZ\(6\)/);
  assert.match(providerBoundaryMigration, /SELECT clock_timestamp\(\) AS "currentTime"[\s\S]*?"providerRequestStartedAt" = "clock"\."currentTime",[\s\S]*?"leaseStartedAt" = "clock"\."currentTime"[\s\S]*?WHERE "attempt"\."status" = 'STARTED'/);
  assert.match(providerBoundaryMigration, /"providerRequestStartedAt" >= "leaseStartedAt"/);
  assert.match(service, /if \(!attempt\.leaseStartedAt\)/);
  assert.match(service, /startedAt: attempt\.leaseStartedAt/);
  assert.doesNotMatch(service, /startedAt: attempt\.startedAt/);
  assert.match(service, /SELECT clock_timestamp\(\) AS "currentTime"/);
  assert.match(service, /providerRequestStartedAt: databaseClock\.currentTime,[\s\S]*?leaseStartedAt: databaseClock\.currentTime/);
});

test('provider-request marker authorizes and scopes before establishing external-I/O ambiguity', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-attempt-recovery-service.ts');
  const markerIndex = service.indexOf('export async function markHospitalitySupplierReservationProviderRequestStarted');
  const authorityIndex = service.indexOf('await requireSupplierReservationRecoveryAuthority', markerIndex);
  const transactionIndex = service.indexOf('return db.$transaction', markerIndex);
  const updateIndex = service.indexOf('providerRequestStartedAt: databaseClock.currentTime', markerIndex);
  assert.ok(markerIndex >= 0 && authorityIndex > markerIndex && transactionIndex > authorityIndex && updateIndex > transactionIndex);
  assert.match(service, /id: input\.attemptId,[\s\S]*?organizationId: input\.organizationId,[\s\S]*?reservationId: reservation\.id/);
  assert.match(service, /sequence: reservation\.attemptCount,[\s\S]*?kind: expectedAttemptKind\(reservation\.status\),[\s\S]*?status: 'STARTED'/);
  assert.match(service, /if \(attempt\.providerRequestStartedAt\) return attempt/);
  assert.match(service, /action: 'supplier\.reservation-provider-request-started'/);
});

test('stale recovery authorizes first, scopes every database read, and preserves the shared operation lock', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-attempt-recovery-service.ts');
  const recoveryIndex = service.indexOf('export async function recoverStaleHospitalitySupplierReservationAttempt');
  const authorityIndex = service.indexOf('await requireSupplierReservationRecoveryAuthority', recoveryIndex);
  const transactionIndex = service.indexOf('return db.$transaction', recoveryIndex);
  assert.ok(recoveryIndex >= 0 && authorityIndex > recoveryIndex && transactionIndex > authorityIndex);
  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /id: input\.reservationId,[\s\S]*?organizationId: input\.organizationId/);
  assert.match(service, /organizationId: input\.organizationId,[\s\S]*?reservationId: reservation\.id,[\s\S]*?sequence: reservation\.attemptCount,[\s\S]*?status: 'STARTED'/);
  assert.match(service, /supplier-reservation:\$\{organizationId\}:operation:\$\{reservationId\}/);
  assert.match(service, /isolationLevel: 'Serializable'/);
});

test('expired create is retryable only when durable evidence proves provider request never started', () => {
  const lease = source('src/server/suppliers/hospitality-supplier-reservation-attempt-lease.ts');
  const service = source('src/server/suppliers/hospitality-supplier-reservation-attempt-recovery-service.ts');
  assert.match(lease, /!input\.providerRequestStarted[\s\S]*?attemptKind === 'CREATE' \? 'PREPARED' : 'AMBIGUOUS'/);
  assert.match(lease, /attemptStatus: 'FAILED'/);
  assert.match(lease, /EXECUTION_LEASE_EXPIRED_BEFORE_PROVIDER_REQUEST/);
  assert.match(lease, /operationStatus: 'AMBIGUOUS',[\s\S]*?attemptStatus: 'AMBIGUOUS',[\s\S]*?HOSPITALITY_SUPPLIER_RESERVATION_PROVIDER_LEASE_EXPIRED_FAILURE_CODE/);
  assert.match(service, /providerRequestStarted: attempt\.providerRequestStartedAt !== null/);
  assert.match(service, /status: recovery\.operationStatus/);
  assert.match(service, /status: recovery\.attemptStatus/);
  assert.doesNotMatch(service, /status: 'PREPARED'/);
});

test('reconciliation marks provider-request evidence immediately before provider I/O', () => {
  const coordinator = source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts');
  const markIndex = coordinator.indexOf('await markHospitalitySupplierReservationProviderRequestStarted');
  const providerIndex = coordinator.indexOf('await input.provider.retrieveReservation');
  assert.ok(markIndex >= 0 && providerIndex > markIndex);
  assert.match(coordinator, /attemptId: claim\.attempt\.id/);
  assert.match(coordinator, /requestCorrelationId: claim\.attempt\.id/);
});

test('recovery audit stays privacy-minimal and disposable database coverage is registered', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-attempt-recovery-service.ts');
  const runner = source('scripts/run-database-tests.mjs');
  const auditBlocks = [...service.matchAll(/afterData: \{([\s\S]*?)\n        \},/g)].map((match) => match[1]).join('\n');
  assert.doesNotMatch(auditBlocks, /supplierPropertyReference|supplierOfferReference|providerReservationReference|providerCorrelation|reservationPayloadFingerprint/);
  assert.doesNotMatch(service, /encryptedCredentials|accessToken|requestPayload|responseBody|cardNumber|cvv/i);
  assert.match(runner, /hospitality-supplier-reservation-attempt-recovery\.integration\.ts/);
});
