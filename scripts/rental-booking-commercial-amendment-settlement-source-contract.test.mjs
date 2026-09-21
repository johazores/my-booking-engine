import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const schema = read('prisma/rental-booking-commercial-amendment-settlement.prisma');
const amendmentSchema = read('prisma/rental-booking-commercial-amendments.prisma');
const migration = read('prisma/migrations/20260918111000_rental_commercial_amendment_manual_settlement/migration.sql');
const manualReferenceMigration = read('prisma/migrations/20260918225500_rental-manual-reference-registry/migration.sql');
const operationalAuthorityMigration = read('prisma/migrations/20260920082500-rental-commercial-amendment-operational-authority/migration.sql');
const domain = read('src/server/bookings/rental-booking-commercial-amendment-settlement-domain.ts');
const service = read('src/server/bookings/rental-booking-commercial-amendment-settlement-service.ts');
const docs = read('docs/rental-booking-commercial-amendment-settlement.md');
const reviewPage = read('app/inventory/rentals/bookings/[booking-id]/reschedule/page.tsx');
const amendmentPage = read('app/inventory/rentals/bookings/[booking-id]/commercial-amendments/[amendment-id]/page.tsx');
const actionRoute = read('app/api/inventory/rentals/bookings/[booking-id]/commercial-amendments/[amendment-id]/route.ts');

const postgresIdentifier = (name) => Buffer.from(name, 'utf8').subarray(0, 63).toString('utf8');

test('commercial amendment settlement persistence is tenant-owned, exact, and append-only', () => {
  assert.match(schema, /model RentalBookingCommercialAmendmentSettlementTransaction/);
  assert.match(schema, /amendmentId\s+String\s+@db\.Uuid/);
  assert.match(schema, /purpose\s+RentalBookingCommercialAmendmentSettlementPurpose/);
  assert.match(schema, /amendment\s+RentalBookingCommercialAmendment\s+@relation\(fields: \[amendmentId, bookingId, organizationId\]/);
  assert.match(amendmentSchema, /settlementTransactions\s+RentalBookingCommercialAmendmentSettlementTransaction\[\]/);
  assert.match(amendmentSchema, /@@unique\(\[id, bookingId, organizationId\]/);
  assert.match(migration, /settlement evidence is append-only/);
  assert.match(migration, /must match the exact retained delta/);
  assert.match(migration, /expired rental commercial amendment authority cannot receive new adjustment money/);
});

test('settlement schema identifiers are explicit and portable within PostgreSQL limits', () => {
  const mappedNames = [...schema.matchAll(/map:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(mappedNames.length >= 7);
  for (const name of mappedNames) {
    assert.ok(Buffer.byteLength(name, 'utf8') <= 63, `${name} exceeds PostgreSQL identifier length`);
    assert.match(migration, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const oldName of [
    'rental_booking_commercial_amendment_settlement_transactions_org_idempotency_key',
    'rental_booking_commercial_amendment_settlement_transactions_org_provider_reference_key',
    'rental_booking_commercial_amendment_settlement_transactions_org_amendment_purpose_key',
  ]) {
    assert.doesNotMatch(migration, new RegExp(oldName));
  }
});

test('settlement trigger names cannot collapse onto each other after PostgreSQL truncation', () => {
  const triggerNames = [
    'rental_amendment_settlement_authority_guard',
    'rental_amendment_settlement_authority_readiness_guard',
    'rental_booking_commercial_amendment_settlement_transactions_cross_scope_reference_guard',
  ];
  const storedNames = triggerNames.map(postgresIdentifier);

  assert.equal(new Set(storedNames).size, triggerNames.length);
  assert.deepEqual([...storedNames].sort(), storedNames);
  assert.match(migration, /CREATE TRIGGER rental_amendment_settlement_authority_guard/);
  assert.match(operationalAuthorityMigration, /CREATE TRIGGER rental_amendment_settlement_authority_readiness_guard/);
  assert.doesNotMatch(operationalAuthorityMigration, /rental_booking_commercial_amendment_settlement_transactions_authority_readiness_guard/);
  assert.match(manualReferenceMigration, /DROP TRIGGER IF EXISTS rental_booking_commercial_amendment_settlement_transactions_cross_scope_reference_guard/);
});

test('database protects uncompensated money and tenant-wide manual reference isolation', () => {
  assert.match(migration, /uncompensated adjustment money cannot terminate/);
  assert.match(migration, /rental_booking_commercial_amendment_settlement_transactions_cross_scope_reference_guard/);
  for (const table of [
    'rental_payment_transactions',
    'rental_damage_settlement_transactions',
    'rental_security_bond_transactions',
    'rental_late_return_settlement_transactions',
    'rental_booking_commercial_amendment_settlement_transactions',
  ]) assert.ok(migration.includes(table), `missing manual reference scope: ${table}`);
  assert.match(migration, /sf:rental-manual-reference:/);
  assert.match(migration, /pg_advisory_xact_lock/);
});

test('manual settlement service derives money and refund source server-side and supports exact compensation', () => {
  for (const token of [
    "'booking:manage'", "'payment:manage'", "'booking:read'", "'payment:read'",
    'rentalBookingLockKey', 'settlementLockKey', 'ManualPaymentProvider',
    "assertPaymentProviderCapability(manualProvider, 'OFFLINE_RECORDING')",
    "assertPaymentProviderCapability(manualProvider, 'OFFLINE_REFUND_RECORDING')",
    'readRentalPaymentSettlementHistory', 'deriveRentalPaymentSettlement', 'deriveBookingSettlementSummary',
    'deriveRentalBookingCommercialAmendmentRefundSource', 'assertManualReferenceUnused',
    'payment.rental.commercial-amendment-adjustment-recorded',
    'payment.rental.commercial-amendment-compensated',
  ]) assert.ok(service.includes(token), `missing settlement service token: ${token}`);
  assert.match(service, /amountMinor: amendment\.deltaMinor/);
  assert.match(service, /currency: amendment\.currency/);
  assert.match(service, /purpose: 'ADJUSTMENT'/);
  assert.match(service, /amendmentId: \{ not: input\.amendmentId \}/);
  assert.match(service, /sourceProviderReference = source\.providerReference/);
  assert.doesNotMatch(service, /sourceProviderReference\?: unknown/);
});

test('settlement domain has exact lifecycle states and deterministic one-source refund authority', () => {
  for (const state of ['UNSETTLED', 'SETTLED', 'COMPENSATED', 'CONFLICT']) assert.ok(domain.includes(`'${state}'`));
  assert.match(domain, /row\.amountMinor !== input\.deltaMinor/);
  assert.match(domain, /compensation\.sourceProviderReference !== adjustment\.providerReference/);
  assert.match(domain, /deriveRentalBookingCommercialAmendmentRefundSource/);
  assert.match(domain, /deriveNextBookingRefundSource/);
  assert.match(domain, /No single retained booking-price payment source can cover/);
  assert.match(domain, /buildRentalBookingCommercialAmendmentSettlementRequestFingerprint/);
});

test('staff surface exposes the real manual settlement lifecycle without browser refund-source authority', () => {
  assert.match(docs, /authenticated staff orchestration/i);
  assert.match(docs, /Manual\/offline staff actions/i);
  assert.match(docs, /PostgreSQL identifier/i);
  assert.match(reviewPage, /Prepare commercial amendment/);
  assert.match(amendmentPage, /Record adjustment payment/);
  assert.match(amendmentPage, /Record adjustment refund/);
  assert.match(amendmentPage, /Server-selected refund source/);
  assert.match(amendmentPage, /Record full compensation/);
  assert.match(amendmentPage, /Apply commercial date change/);
  assert.match(actionRoute, /recordRentalBookingCommercialAmendmentManualSettlement/);
  assert.match(actionRoute, /recordRentalBookingCommercialAmendmentManualCompensation/);
  assert.match(actionRoute, /applyRentalBookingCommercialAmendment/);
  assert.doesNotMatch(amendmentPage, /name="sourceProviderReference"/);
  assert.doesNotMatch(actionRoute, /formField\(formData, 'sourceProviderReference'\)/);
  assert.doesNotMatch(amendmentPage, /fetch\(/);
});
