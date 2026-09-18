import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const bookingPaymentService = read('src/server/payments/rental-payment-service.ts');
const damageSettlementService = read('src/server/payments/rental-damage-settlement-service.ts');
const securityBondService = read('src/server/payments/rental-security-bond-service.ts');
const lateReturnSettlementService = read('src/server/payments/rental-late-return-settlement-service.ts');
const commercialAmendmentSettlementService = read('src/server/bookings/rental-booking-commercial-amendment-settlement-service.ts');
const effectiveRefundService = read('src/server/bookings/rental-booking-effective-refund-service.ts');
const registrySchema = read('prisma/rental-manual-provider-references.prisma');
const registryMigration = read('prisma/migrations/20260918225500_rental-manual-reference-registry/migration.sql');
const docs = read('docs/rental-manual-reference-isolation.md');

const serviceSources = [
  bookingPaymentService,
  damageSettlementService,
  securityBondService,
  lateReturnSettlementService,
  commercialAmendmentSettlementService,
  effectiveRefundService,
];

const ledgerTables = [
  'rental_payment_transactions',
  'rental_damage_settlement_transactions',
  'rental_security_bond_transactions',
  'rental_late_return_settlement_transactions',
  'rental_booking_commercial_amendment_settlement_transactions',
  'rental_booking_effective_refund_transactions',
];

test('all manual rental money writers retain the shared tenant-reference serialization boundary', () => {
  for (const service of serviceSources) {
    assert.match(service, /sf:rental-manual-reference:/);
    assert.match(service, /pg_advisory_xact_lock/);
    assert.match(service, /providerCode:\s*'manual'|manualProvider/);
  }
});

test('all application preflight checks use the central tenant-scoped reference registry', () => {
  for (const service of serviceSources) {
    assert.match(service, /rentalManualProviderReference\.findUnique/);
    assert.match(service, /organizationId_providerReference/);
    assert.doesNotMatch(
      service,
      /rentalDamageSettlementTransaction\.findFirst\(\{ where: \{ organizationId, providerCode: 'manual', providerReference: reference/,
    );
    assert.doesNotMatch(
      service,
      /rentalSecurityBondTransaction\.findFirst\(\{ where: \{ organizationId, providerCode: 'manual', providerReference: reference/,
    );
    assert.doesNotMatch(
      service,
      /rentalLateReturnSettlementTransaction\.findFirst\(\{ where: \{ organizationId, providerCode: 'manual', providerReference: reference/,
    );
  }
});

test('application collision checks execute before every manual provider adapter call', () => {
  const checks = [
    [bookingPaymentService, 'assertRentalManualReferenceUnused(transaction, input.organizationId, reference)', 'manualProvider.recordOfflinePayment'],
    [bookingPaymentService, 'assertRentalManualReferenceUnused(transaction, input.organizationId, refundReference)', 'manualProvider.recordOfflineRefund'],
    [damageSettlementService, 'assertManualReferenceUnused(transaction, input.organizationId, reference)', 'manualProvider.recordOfflinePayment'],
    [damageSettlementService, 'assertManualReferenceUnused(transaction, input.organizationId, refundReference)', 'manualProvider.recordOfflineRefund'],
    [securityBondService, 'assertManualReferenceUnused(transaction, input.organizationId, reference)', 'manualProvider.recordOfflinePayment'],
    [lateReturnSettlementService, 'assertManualReferenceUnused(transaction, input.organizationId, reference)', 'manualProvider.recordOfflinePayment'],
    [lateReturnSettlementService, 'assertManualReferenceUnused(transaction, input.organizationId, refundReference)', 'manualProvider.recordOfflineRefund'],
    [commercialAmendmentSettlementService, 'assertManualReferenceUnused(transaction, input.organizationId, reference)', 'manualProvider.recordOfflinePayment'],
    [effectiveRefundService, 'assertManualReferenceUnused(transaction, input.organizationId, reference)', 'manualProvider.recordOfflineRefund'],
  ];

  for (const [service, guard, providerCall] of checks) {
    const guardIndex = service.indexOf(guard);
    const providerIndex = service.indexOf(providerCall, guardIndex);
    assert.ok(guardIndex >= 0, `missing pre-provider reference guard: ${guard}`);
    assert.ok(providerIndex > guardIndex, `${guard} must execute before ${providerCall}`);
  }
});

test('the registry is a tenant-scoped immutable identity index rather than another settlement ledger', () => {
  assert.match(registrySchema, /model RentalManualProviderReference/);
  assert.match(registrySchema, /organizationId\s+String\s+@db\.Uuid/);
  assert.match(registrySchema, /providerReference\s+String\s+@db\.VarChar\(160\)/);
  assert.match(registrySchema, /@@id\(\[organizationId, providerReference\]/);
  assert.match(registrySchema, /@@unique\(\[organizationId, sourceLedger, sourceId\]/);
  assert.doesNotMatch(registrySchema, /amountMinor|currency|status|kind/);

  assert.match(registryMigration, /rental manual provider reference registry is append-only/i);
  assert.match(registryMigration, /not backed by matching tenant settlement evidence/i);
  assert.match(registryMigration, /providerCode" = 'manual'/);
});

test('migration backfills and protects every current manual rental settlement ledger', () => {
  assert.match(registryMigration, /CREATE TABLE "rental_manual_provider_references"/);
  assert.match(registryMigration, /cannot build rental manual provider reference registry because duplicate tenant references already exist/);
  assert.match(registryMigration, /CREATE OR REPLACE FUNCTION sf_guard_rental_manual_reference_cross_scope/);
  assert.match(registryMigration, /CREATE FUNCTION sf_register_rental_manual_reference/);
  assert.match(registryMigration, /sf:rental-manual-reference:/);

  for (const table of ledgerTables) {
    assert.match(registryMigration, new RegExp(table));
    assert.match(registryMigration, new RegExp(`${table}_cross_scope_reference_guard`));
    assert.match(registryMigration, new RegExp(`${table}_register_manual_reference`));
  }
});

test('registration remains transactional and the reference itself is the global identity, not refund source attribution', () => {
  assert.match(registryMigration, /AFTER INSERT ON "rental_payment_transactions"/);
  assert.match(registryMigration, /INSERT INTO "rental_manual_provider_references"/);
  assert.match(registryMigration, /PRIMARY KEY \("organizationId", "providerReference"\)/);
  assert.doesNotMatch(registryMigration, /sourceProviderReference/);
  assert.match(registryMigration, /sourceLedger" VARCHAR\(96\)/);
  assert.match(registryMigration, /sourceId" UUID/);
});

test('documentation names all six ledgers and the fail-closed application and migration behavior', () => {
  for (const name of [
    'RentalPaymentTransaction',
    'RentalDamageSettlementTransaction',
    'RentalSecurityBondTransaction',
    'RentalLateReturnSettlementTransaction',
    'RentalBookingCommercialAmendmentSettlementTransaction',
    'RentalBookingEffectiveRefundTransaction',
  ]) assert.match(docs, new RegExp(name));

  assert.match(docs, /sourceProviderReference.*not globally unique/s);
  assert.match(docs, /application.*registry.*before.*ManualPaymentProvider/is);
  assert.match(docs, /fails closed if historical duplicate tenant references are discovered/i);
  assert.match(docs, /GitHub Actions are not required or used/i);
});
