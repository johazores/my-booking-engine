import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('supplier reservation persistence is tenant-scoped and exact-idempotency constrained', () => {
  const schema = source('prisma/hospitality-supplier-reservations.prisma');
  const migration = source('prisma/migrations/20260906053500_hospitality-supplier-reservation-operations/migration.sql');
  assert.match(schema, /@@unique\(\[organizationId, idempotencyKey\]\)/);
  assert.match(schema, /requestFingerprint\s+String\s+@db\.Char\(64\)/);
  assert.match(schema, /reservationPayloadFingerprint\s+String\s+@db\.Char\(64\)/);
  assert.match(schema, /integration\s+Integration\s+@relation\(fields: \[integrationId, organizationId\], references: \[id, organizationId\]/);
  assert.match(migration, /FOREIGN KEY \("integrationId", "organizationId"\)/);
  assert.match(migration, /REFERENCES "integrations"\("id", "organizationId"\)/);
  assert.match(migration, /hospitality_supplier_reservation_operations_org_idempotency_key/);
  assert.match(migration, /hospitality_supplier_reservation_operations_confirmed_reference_check/);
  assert.match(migration, /array_position\("childAges", NULL\) IS NULL/);
  assert.match(migration, /0 <= ALL\("childAges"\)/);
  assert.match(migration, /17 >= ALL\("childAges"\)/);
  assert.doesNotMatch(migration, /org_provider_reference_key[\s\S]*?WHERE "providerReservationReference" IS NOT NULL/);
});

test('supplier reservation service authorizes before tenant-scoped persistence and never loads provider credentials', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');
  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /capabilities: \{ has: 'reservation' \}/);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.doesNotMatch(service, /encryptedCredentials|loadActiveIntegrationCredentials|readTravelportStaysCredentials/);
});

test('ambiguous supplier create outcomes cannot be converted into blind retries', () => {
  const domain = source('src/server/suppliers/hospitality-supplier-reservation-domain.ts');
  const service = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');
  assert.match(domain, /must be reconciled before another create attempt/);
  assert.match(domain, /status !== 'AMBIGUOUS'/);
  assert.match(service, /status: 'RECONCILING'/);
  assert.match(service, /input\.outcome\.status === 'NOT_FOUND'[\s\S]*?\? 'PREPARED'/);
  assert.match(service, /input\.outcome\.status === 'FOUND'[\s\S]*?\? 'CONFIRMED'/);
});

test('supplier operation audits exclude opaque supplier references and request payload data', () => {
  const service = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');
  const auditBlocks = [...service.matchAll(/afterData: \{([\s\S]*?)\n        \},/g)].map((match) => match[1]).join('\n');
  assert.doesNotMatch(auditBlocks, /supplierPropertyReference|supplierOfferReference|providerReservationReference|lastProviderCorrelationId|reservationPayloadFingerprint/);
  assert.doesNotMatch(service, /rawError|requestPayload|credentials|accessToken|bearer/i);
});
