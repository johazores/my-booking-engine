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
const initialCrossScopeMigration = read('prisma/migrations/20260917014500_rental_manual_reference_cross_scope/migration.sql');
const lateReturnMigration = read('prisma/migrations/20260917082000_rental_late_return_settlement/migration.sql');
const damageDocs = read('docs/rental-damage-settlement.md');
const bondDocs = read('docs/rental-security-bond.md');

const ledgers = [
  'rentalPaymentTransaction.findFirst',
  'rentalDamageSettlementTransaction.findFirst',
  'rentalSecurityBondTransaction.findFirst',
  'rentalLateReturnSettlementTransaction.findFirst',
];

function assertGlobalReferenceBoundary(service) {
  assert.match(service, /sf:rental-manual-reference:/);
  assert.match(service, /pg_advisory_xact_lock/);
  for (const ledger of ledgers) assert.match(service, new RegExp(ledger.replace('.', '\\.')));
}

test('all rental manual settlement writers use one tenant-wide pre-provider reference boundary', () => {
  for (const service of [bookingPaymentService, damageSettlementService, securityBondService, lateReturnSettlementService]) {
    assertGlobalReferenceBoundary(service);
  }

  assert.ok(
    damageSettlementService.indexOf('assertManualReferenceUnused(transaction, input.organizationId, reference)')
      < damageSettlementService.indexOf('manualProvider.recordOfflinePayment'),
  );
  assert.ok(
    damageSettlementService.indexOf('assertManualReferenceUnused(transaction, input.organizationId, refundReference)')
      < damageSettlementService.indexOf('manualProvider.recordOfflineRefund'),
  );
  assert.ok(
    securityBondService.indexOf('assertManualReferenceUnused(transaction, input.organizationId, reference)')
      < securityBondService.indexOf('manualProvider.recordOfflinePayment'),
  );
});

test('database reference isolation covers booking, damage, bond, and late-return ledgers', () => {
  assert.match(initialCrossScopeMigration, /sf:rental-manual-reference:/);
  assert.match(initialCrossScopeMigration, /rental_payment_transactions/);
  assert.match(initialCrossScopeMigration, /rental_damage_settlement_transactions/);
  assert.match(initialCrossScopeMigration, /rental_security_bond_transactions/);

  assert.match(lateReturnMigration, /CREATE OR REPLACE FUNCTION sf_guard_rental_manual_reference_cross_scope/);
  assert.match(lateReturnMigration, /sf:rental-manual-reference:/);
  for (const table of [
    'rental_payment_transactions',
    'rental_damage_settlement_transactions',
    'rental_security_bond_transactions',
    'rental_late_return_settlement_transactions',
  ]) assert.match(lateReturnMigration, new RegExp(table));
});

test('documentation describes pre-provider and database defense in depth', () => {
  assert.match(damageDocs, /before manual provider-adapter I\/O/i);
  assert.match(damageDocs, /booking-price, damage, security-bond, and late-return ledgers/i);
  assert.match(bondDocs, /before manual provider-adapter I\/O/i);
  assert.match(bondDocs, /booking-price, damage, security-bond, and late-return ledgers/i);
  for (const docs of [damageDocs, bondDocs]) {
    assert.match(docs, /(?:PostgreSQL|database) independently/i);
  }
});
