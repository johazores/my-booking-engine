import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('supplier reservation persistence is tenant-scoped and exact-idempotency constrained', () => {
  const schema = source('prisma/hospitality-supplier-reservations.prisma');
  const migration = source('prisma/migrations/20260906053500_hospitality-supplier-reservation-operations/migration.sql');
  const authorityMigration = source('prisma/migrations/20260906075200_supplier-reservation-authority-binding/migration.sql');
  const confirmationMigration = source('prisma/migrations/20260906112500_supplier-reservation-confirmation-evidence/migration.sql');
  assert.match(schema, /@@unique\(\[organizationId, idempotencyKey\]\)/);
  assert.match(schema, /requestFingerprint\s+String\s+@db\.Char\(64\)/);
  assert.match(schema, /requestFingerprintVersion\s+Int\?\s+@default\(2\)/);
  assert.match(schema, /reservationPayloadFingerprint\s+String\s+@db\.Char\(64\)/);
  assert.match(schema, /supplierConfirmationReference\s+String\?\s+@db\.VarChar\(512\)/);
  assert.match(schema, /integration\s+Integration\s+@relation\(fields: \[integrationId, organizationId\], references: \[id, organizationId\]/);
  assert.match(migration, /FOREIGN KEY \("integrationId", "organizationId"\)/);
  assert.match(migration, /REFERENCES "integrations"\("id", "organizationId"\)/);
  assert.match(migration, /hospitality_supplier_reservation_operations_org_idempotency_key/);
  assert.match(migration, /hospitality_supplier_reservation_operations_confirmed_reference_check/);
  assert.match(migration, /array_position\("childAges", NULL\) IS NULL/);
  assert.match(migration, /0 <= ALL\("childAges"\)/);
  assert.match(migration, /17 >= ALL\("childAges"\)/);
  assert.doesNotMatch(migration, /org_provider_reference_key[\s\S]*?WHERE "providerReservationReference" IS NOT NULL/);
  assert.match(authorityMigration, /ADD COLUMN "requestFingerprintVersion" INTEGER/);
  assert.match(authorityMigration, /ALTER COLUMN "requestFingerprintVersion" SET DEFAULT 2/);
  assert.match(authorityMigration, /requestFingerprintVersion" IS NULL/);
  assert.match(authorityMigration, /requestFingerprintVersion" = 2/);
  assert.match(confirmationMigration, /ADD COLUMN "supplierConfirmationReference" VARCHAR\(512\)/);
  assert.match(confirmationMigration, /DROP CONSTRAINT "hospitality_supplier_reservation_operations_confirmed_reference_check"/);
  assert.match(confirmationMigration, /provider_reference_state_check/);
  assert.match(confirmationMigration, /provider_reference_format_check/);
  assert.match(confirmationMigration, /supplier_confirmation_reference_check/);
});

test('supplier reservation service authorizes before tenant-scoped persistence and domain binds reviewed authority', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');
  const domain = source('src/server/suppliers/hospitality-supplier-reservation-domain.ts');
  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /capabilities: \{ has: 'reservation' \}/);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(domain, /selection\.reservationAuthorityFingerprint/);
  assert.match(domain, /requestFingerprintVersion !== 2/);
  assert.match(domain, /authority must be reviewed again before submission/);
  assert.doesNotMatch(service, /encryptedCredentials|loadActiveIntegrationCredentials|readTravelportStaysCredentials/);
});

test('ambiguous supplier creates require exact known-locator provider truth before another create attempt', () => {
  const domain = source('src/server/suppliers/hospitality-supplier-reservation-domain.ts');
  const service = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');
  const reconciliation = source('src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts');
  assert.match(domain, /must be reconciled before another create attempt/);
  assert.match(domain, /status !== 'AMBIGUOUS'/);
  assert.match(service, /status: 'RECONCILING'/);
  assert.match(service, /cannot be reconciled automatically without a provider reservation reference/);
  assert.match(service, /input\.outcome\.status === 'NOT_FOUND'[\s\S]*?\? 'PREPARED'/);
  assert.match(service, /input\.outcome\.status === 'FOUND'[\s\S]*?\? 'CONFIRMED'/);
  assert.match(service, /recovery returned a different provider reservation reference/);
  assert.match(reconciliation, /result\.providerReservationReference !== providerReservationReference/);
  assert.match(reconciliation, /status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE'/);
  const identityCheck = reconciliation.indexOf('result.providerReservationReference !== providerReservationReference');
  const notFoundSettlement = reconciliation.indexOf("status: 'NOT_FOUND'", identityCheck);
  assert.ok(identityCheck >= 0 && notFoundSettlement > identityCheck, 'locator identity must be checked before NOT_FOUND can make a create retryable');
  const reconcileStart = service.indexOf('export async function claimHospitalitySupplierReservationReconciliation');
  const reconcileEnd = service.indexOf('export type HospitalitySupplierReservationReconciliationOutcome');
  const reconciliationClaim = service.slice(reconcileStart, reconcileEnd);
  assert.doesNotMatch(reconciliationClaim, /requestFingerprintVersion/);
});

test('supplier operation audits exclude opaque supplier references and request payload data', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');
  const auditBlocks = [...service.matchAll(/afterData: \{([\s\S]*?)\n        \},/g)].map((match) => match[1]).join('\n');
  assert.doesNotMatch(auditBlocks, /supplierPropertyReference|supplierOfferReference|providerReservationReference|supplierConfirmationReference|lastProviderCorrelationId|reservationPayloadFingerprint/);
  assert.doesNotMatch(service, /rawError|requestPayload|credentials|accessToken|bearer/i);
});
