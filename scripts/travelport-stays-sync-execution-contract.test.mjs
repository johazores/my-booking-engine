import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('recovery writes have a distinct durable attempt kind without adding a second operation state', () => {
  const schema = source('prisma/hospitality-supplier-reservations.prisma');
  const migration = source('prisma/migrations/20260907053000_supplier-reservation-recovery-write-attempt/migration.sql');
  assert.match(schema, /enum HospitalitySupplierReservationAttemptKind\s*\{[\s\S]*RECOVERY_WRITE/);
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'RECOVERY_WRITE'/);
  assert.doesNotMatch(schema, /\bSYNCING\b|\bRECOVERING\b/);
});

test('provider-neutral recovery-write claim is tenant scoped and blocks replay after provider boundary', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-recovery-write-service.ts');
  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /id: input\.reservationId, organizationId: input\.organizationId/);
  assert.match(service, /reservation\.providerReservationReference/);
  assert.match(service, /reservation\.supplierConfirmationReference/);
  assert.match(service, /reservation\.providerRecoveryReference/);
  assert.match(service, /reservation\.reservationPayloadFingerprint !== input\.reservationPayloadFingerprint/);
  assert.match(service, /latestAttempt\.providerRequestStartedAt === null/);
  assert.match(service, /kind: 'RECOVERY_WRITE'/);
  assert.match(service, /status: 'SUBMITTING'/);
  assert.match(service, /A provider-marked recovery write cannot be settled as retryable/);
});

test('Travelport Sync sends only retained recovery authority and authorized traveler email', () => {
  const domain = source('src/server/suppliers/travelport-stays-reservation-sync-domain.ts');
  const executor = source('src/server/suppliers/travelport-stays-reservation-sync-executor.ts');
  assert.match(domain, /passiveOfferInd: true/);
  assert.match(domain, /sourceContext: 'Supplier'/);
  assert.match(domain, /Email:/);
  assert.match(executor, /book\/reservations\//);
  assert.match(executor, /await input\.beforeProviderRequest\(\)/);
  assert.doesNotMatch(domain, /FormOfPayment|PaymentCard|CardNumber|SeriesCode/);
  assert.doesNotMatch(executor, /paymentCard|securityCode|cardNumber/);
});

test('Sync confirmation requires original supplier confirmation and exact reservation classifier authority', () => {
  const domain = source('src/server/suppliers/travelport-stays-reservation-sync-domain.ts');
  assert.match(domain, /classifyTravelportStaysReservationCreateOutcome/);
  assert.match(domain, /createShape\.supplierConfirmationReference === expectedSupplierConfirmation/);
  assert.match(domain, /status: 'AMBIGUOUS'/);
  assert.match(domain, /failureCode: 'INVALID_RESPONSE'/);
});

test('Sync coordinator remains server-only and uses durable marker and settlement', () => {
  const service = source('src/server/suppliers/travelport-stays-reservation-sync-service.ts');
  assert.match(service, /claimHospitalitySupplierReservationRecoveryWrite/);
  assert.match(service, /markHospitalitySupplierReservationProviderRequestStarted/);
  assert.match(service, /settleHospitalitySupplierReservationRecoveryWrite/);
  assert.match(service, /reservationSyncExecutor\.syncReservation/);
  assert.doesNotMatch(service, /FormOfPayment|paymentCard|securityCode|cardNumber/);
  const runner = source('scripts/run-database-tests.mjs');
  assert.match(runner, /hospitality-supplier-reservation-recovery-write\.integration\.ts/);
});
