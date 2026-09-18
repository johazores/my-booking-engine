import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const schema = read('prisma/rental-late-return-settlement.prisma');
const assessmentSchema = read('prisma/rental-late-return.prisma');
const migration = read('prisma/migrations/20260917082000_rental_late_return_settlement/migration.sql');
const service = read('src/server/payments/rental-late-return-settlement-service.ts');
const domain = read('src/server/payments/rental-late-return-settlement-domain.ts');
const panel = read('src/components/rental-late-return-settlement-panel.tsx');
const assessmentPanel = read('src/components/rental-late-return-assessment-panel.tsx');
const manualRoute = read('app/api/inventory/rentals/bookings/[booking-id]/late-return-assessment/[assessment-id]/settlement/manual/route.ts');
const refundRoute = read('app/api/inventory/rentals/bookings/[booking-id]/late-return-assessment/[assessment-id]/settlement/refund/route.ts');
const docs = read('docs/rental-late-return-settlement.md');

test('late-return settlement persistence is tenant-owned, assessment-linked, append-only, and exact-value', () => {
  assert.match(schema, /model RentalLateReturnSettlementTransaction/);
  assert.match(schema, /assessment\s+RentalLateReturnAssessment\s+@relation\(fields: \[assessmentId, organizationId\]/);
  assert.match(schema, /@@unique\(\[organizationId, assessmentId, kind\]/);
  assert.match(assessmentSchema, /settlementTransactions\s+RentalLateReturnSettlementTransaction\[\]/);
  assert.match(migration, /rental late-return settlement transactions are append-only/);
  assert.match(migration, /assessment\."outcome" = 'FEE_ASSESSED'/);
  assert.match(migration, /NEW\."amountMinor" <> assessment_fee/);
  assert.match(migration, /clock_timestamp\(\)/);
});

test('late-return settlement requires dual booking/payment authority, tenant scope, and bounded serializable writes', () => {
  for (const permission of ['booking:read', 'payment:read', 'booking:manage', 'payment:manage']) {
    assert.match(service, new RegExp(`permission: '${permission}'`));
  }
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /outcome: 'FEE_ASSESSED'/);
  assert.match(service, /rentalBookingLockKey/);
  assert.match(service, /take: 3/);
  assert.match(service, /isolationLevel: 'RepeatableRead'/);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(service, /attempt < 3/);
});

test('manual settlement is deterministic, source-attributed, provider-adapted, and registry-isolated', () => {
  assert.match(service, /ManualPaymentProvider/);
  assert.match(service, /OFFLINE_RECORDING/);
  assert.match(service, /OFFLINE_REFUND_RECORDING/);
  assert.match(service, /buildRentalLateReturnSettlementRequestFingerprint/);
  assert.match(domain, /rental-late-return-settlement-request-v1/);
  assert.match(migration, /\^rental-late-return:manual-payment:\[a-f0-9\]\{48\}\$/);
  assert.match(migration, /\^rental-late-return:manual-refund:\[a-f0-9\]\{48\}\$/);
  assert.match(migration, /matching retained payment evidence/);
  assert.match(migration, /sf:rental-manual-reference:/);
  for (const table of [
    'rental_payment_transactions',
    'rental_damage_settlement_transactions',
    'rental_security_bond_transactions',
    'rental_late_return_settlement_transactions',
  ]) assert.match(migration, new RegExp(table));
  assert.match(service, /manualReferenceLockKey/);
  assert.match(service, /rentalManualProviderReference\.findUnique/);
  assert.match(service, /organizationId_providerReference/);
  assert.doesNotMatch(service, /rentalSecurityBondTransaction\.findFirst\(\{ where: \{ organizationId, providerCode: 'manual', providerReference: reference/);
  assert.doesNotMatch(service, /rentalDamageSettlementTransaction\.findFirst\(\{ where: \{ organizationId, providerCode: 'manual', providerReference: reference/);
  assert.doesNotMatch(service, /rentalPaymentTransaction\.findFirst\(\{ where: \{ organizationId, providerCode: 'manual', providerReference: reference/);
});

test('staff UI and routes expose only real full-value manual payment/refund evidence with safe parsing', () => {
  assert.match(assessmentPanel, /RentalLateReturnSettlementPanel/);
  assert.match(assessmentPanel, /outcome === 'FEE_ASSESSED'/);
  assert.match(panel, /Record late-return payment/);
  assert.match(panel, /Record late-return refund/);
  assert.match(panel, /does not move money or charge a card/);
  assert.match(manualRoute, /recordRentalLateReturnManualOfflinePayment/);
  assert.match(refundRoute, /recordRentalLateReturnManualOfflineRefund/);
  assert.match(manualRoute, /readInventoryFormData/);
  assert.match(refundRoute, /readInventoryFormData/);
  assert.match(manualRoute, /formField\(formData, 'reference'\)/);
  assert.match(refundRoute, /formField\(formData, 'reference'\)/);
});

test('documentation keeps assessment, settlement, booking price, and future provider behavior distinct', () => {
  assert.match(docs, /separate from the immutable rental booking price/i);
  assert.match(docs, /full-value manual\/offline/i);
  assert.match(docs, /does not charge a card/i);
  assert.match(docs, /partial/i);
  assert.match(docs, /provider-backed/i);
  assert.match(docs, /GitHub Actions are not required or used/);
});
