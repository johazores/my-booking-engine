import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('schema and migration keep provider recovery authority bounded and non-secret', () => {
  const schema = source('prisma/hospitality-supplier-reservations.prisma');
  const migration = source('prisma/migrations/20260907024500_travelport-sync-recovery-authority/migration.sql');

  assert.match(schema, /providerRecoveryReference\s+String\?\s+@db\.VarChar\(1024\)/);
  assert.match(migration, /ADD COLUMN "providerRecoveryReference" VARCHAR\(1024\)/);
  assert.match(migration, /"status" IN \('SUBMITTING', 'AMBIGUOUS'\)/);
  assert.match(migration, /"supplierConfirmationReference" IS NOT NULL/);
  assert.match(migration, /"providerRecoveryReference" = btrim\("providerRecoveryReference"\)/);
  assert.match(migration, /"providerRecoveryReference" !~ E'\[\\\\r\\\\n\]'/);
  assert.doesNotMatch(migration.replace(/^--.*$/gm, ''), /card|cvv|pan|traveler|email/i);
});

test('recovery evidence is staged only after the durable provider marker and before final settlement', () => {
  const coordinator = source('src/server/suppliers/travelport-stays-reservation-create-service.ts');
  const marker = coordinator.indexOf('await markHospitalitySupplierReservationProviderRequestStarted');
  const stage = coordinator.indexOf('await recordHospitalitySupplierReservationProviderRecoveryEvidence');
  const map = coordinator.indexOf('travelportStaysCreateOutcomeToSubmissionOutcome', stage);
  const settle = coordinator.indexOf('settleHospitalitySupplierReservationSubmission', map);

  assert.ok(marker >= 0 && stage > marker && map > stage && settle > map);
  assert.match(coordinator, /createOutcome\.status === 'AMBIGUOUS'/);
  assert.match(coordinator, /createOutcome\.providerRecoveryReference/);
  assert.match(coordinator, /createOutcome\.supplierConfirmationReference/);
});

test('provider-neutral staging rechecks tenant authority, current create attempt, and provider-request evidence', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-recovery-evidence-service.ts');

  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /reservation\.status !== 'SUBMITTING'/);
  assert.match(service, /kind: 'CREATE'/);
  assert.match(service, /status: 'STARTED'/);
  assert.match(service, /!attempt\.providerRequestStartedAt/);
  assert.match(service, /supplierConfirmationReference,/);
  assert.match(service, /providerRecoveryReference,/);
  assert.match(service, /isolationLevel: 'Serializable'/);

  const auditBlock = service.match(/action: 'supplier\.reservation-recovery-evidence-recorded'[\s\S]*?afterData: \{([\s\S]*?)\n\s*\},/);
  assert.ok(auditBlock);
  assert.doesNotMatch(auditBlock[1], /supplierConfirmationReference|providerRecoveryReference/);
});

test('Travelport recovery reference retains only offer authority and verified Booking.com source', () => {
  const reference = source('src/server/suppliers/travelport-stays-sync-recovery-reference.ts');
  const classifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');

  assert.match(reference, /travelport-stays-sync-v1/);
  assert.match(reference, /BOOKING_DOT_COM_SUPPLIER_SOURCE = 'BO'/);
  assert.doesNotMatch(reference, /confirmation|email|traveler|card|payment/i);
  assert.match(classifier, /optionalRecord\(offer\.Identifier\)\?\.authority/);
  assert.match(classifier, /providerReservationReference: locators\.provider/);
  assert.match(classifier, /createTravelportStaysSyncRecoveryReference/);
});
