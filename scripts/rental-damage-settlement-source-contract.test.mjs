import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const schema = read('prisma/rental-damage-settlement.prisma');
const migration = read('prisma/migrations/20260917013000_rental_damage_settlement/migration.sql');
const referenceIsolationMigration = read('prisma/migrations/20260917014500_rental_manual_reference_cross_scope/migration.sql');
const forfeitureMigration = read('prisma/migrations/20260917060000_rental_security_bond_forfeiture/migration.sql');
const service = read('src/server/payments/rental-damage-settlement-service.ts');
const domain = read('src/server/payments/rental-damage-settlement-domain.ts');
const panel = read('src/components/rental-damage-settlement-panel.tsx');
const liabilityPanel = read('src/components/rental-damage-liability-panel.tsx');
const damageCasePanel = read('src/components/rental-damage-case-panel.tsx');
const manualRoute = read('app/api/inventory/rentals/bookings/[booking-id]/damage-case/[case-id]/settlement/manual/route.ts');
const refundRoute = read('app/api/inventory/rentals/bookings/[booking-id]/damage-case/[case-id]/settlement/refund/route.ts');
const docs = read('docs/rental-damage-settlement.md');

test('damage settlement persistence is tenant-owned, append-only, and tied to liability authority', () => {
  assert.match(schema, /model RentalDamageSettlementTransaction/);
  assert.match(schema, /liabilityDecision\s+RentalDamageLiabilityDecision\s+@relation\(fields: \[liabilityDecisionId, organizationId\]/);
  assert.match(schema, /@@unique\(\[organizationId, liabilityDecisionId, kind\]/);
  assert.match(migration, /rental damage settlement transactions are append-only/);
  assert.match(migration, /outcome" = 'CUSTOMER_LIABLE'/);
  assert.match(migration, /NEW\."amountMinor" <> liability_amount/);
  assert.match(migration, /clock_timestamp\(\)/);
});

test('damage settlement requires dual booking/payment authority and tenant-scoped retained evidence', () => {
  for (const permission of ['booking:read', 'payment:read', 'booking:manage', 'payment:manage']) assert.match(service, new RegExp(`permission: '${permission}'`));
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /outcome: 'CUSTOMER_LIABLE'/);
  assert.match(service, /rentalUnitLockKey/);
  assert.match(service, /isolationLevel: 'Serializable'/);
});

test('manual provider settlement is full-value, source-attributed, and request-bound', () => {
  assert.match(service, /ManualPaymentProvider/);
  assert.match(service, /OFFLINE_RECORDING/);
  assert.match(service, /OFFLINE_REFUND_RECORDING/);
  assert.match(service, /buildRentalDamageSettlementRequestFingerprint/);
  assert.match(domain, /rental-damage-settlement-request-v1/);
  assert.match(migration, /\^rental-damage:manual-payment:\[a-f0-9\]\{48\}\$/);
  assert.match(migration, /\^rental-damage:manual-refund:\[a-f0-9\]\{48\}\$/);
  assert.match(migration, /matching retained payment evidence/);
  assert.match(referenceIsolationMigration, /sf:rental-manual-reference:/);
  assert.match(referenceIsolationMigration, /rental_payment_transactions_cross_scope_reference_guard/);
  assert.match(referenceIsolationMigration, /rental_damage_settlement_transactions_cross_scope_reference_guard/);
  assert.match(referenceIsolationMigration, /pg_advisory_xact_lock/);
});

test('security-bond forfeiture is an alternative exact settlement and cannot double-collect the liability', () => {
  assert.match(forfeitureMigration, /sf:rental-damage-liability-settlement:/);
  assert.match(forfeitureMigration, /rental_damage_settlement_transactions_bond_forfeiture_guard/);
  assert.match(forfeitureMigration, /customer damage liability is already settled by security bond forfeiture/);
  assert.match(panel, /Settled by bond/);
  assert.match(panel, /!forfeiture && result\.settlement\.state === 'UNPAID'/);
  assert.match(docs, /Partial bond offsets are intentionally unsupported/);
});

test('staff UI and routes expose real evidence actions without pretending to move money', () => {
  assert.match(liabilityPanel, /RentalDamageSettlementPanel/);
  assert.match(damageCasePanel, /organizationId=\{organizationId\}/);
  assert.match(damageCasePanel, /actorUserId=\{actorUserId\}/);
  assert.match(panel, /Record damage payment/);
  assert.match(panel, /Record damage refund/);
  assert.match(panel, /does not move money or charge a card/);
  assert.match(manualRoute, /recordRentalDamageManualOfflinePayment/);
  assert.match(refundRoute, /recordRentalDamageManualOfflineRefund/);
  assert.match(docs, /separate from the rental booking price/);
  assert.match(docs, /Security-bond forfeiture alternative/);
  assert.match(docs, /manual\/offline settlement evidence/i);
});
