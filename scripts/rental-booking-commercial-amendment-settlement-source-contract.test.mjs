import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const schema = read('prisma/rental-booking-commercial-amendment-settlement.prisma');
const amendmentSchema = read('prisma/rental-booking-commercial-amendments.prisma');
const migration = read('prisma/migrations/20260918111000_rental_commercial_amendment_manual_settlement/migration.sql');
const domain = read('src/server/bookings/rental-booking-commercial-amendment-settlement-domain.ts');
const service = read('src/server/bookings/rental-booking-commercial-amendment-settlement-service.ts');
const docs = read('docs/rental-booking-commercial-amendment-settlement.md');

const pagePath = 'app/inventory/rentals/bookings/[booking-id]/reschedule/page.tsx';
let page = '';
try { page = read(pagePath); } catch { /* focused fixture may omit existing page */ }

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

test('manual settlement service derives money server-side and supports exact compensation', () => {
  for (const token of [
    "'booking:manage'",
    "'payment:manage'",
    "'booking:read'",
    "'payment:read'",
    'rentalBookingLockKey',
    'settlementLockKey',
    'ManualPaymentProvider',
    "assertPaymentProviderCapability(manualProvider, 'OFFLINE_RECORDING')",
    "assertPaymentProviderCapability(manualProvider, 'OFFLINE_REFUND_RECORDING')",
    'assertRefundSourceCapacity',
    'assertManualReferenceUnused',
    'payment.rental.commercial-amendment-adjustment-recorded',
    'payment.rental.commercial-amendment-compensated',
  ]) assert.ok(service.includes(token), `missing settlement service token: ${token}`);
  assert.match(service, /amountMinor: amendment\.deltaMinor/);
  assert.match(service, /currency: amendment\.currency/);
  assert.match(service, /sourceProviderReference/);
});

test('settlement domain has only exact unsettled, settled, compensated, or conflict states', () => {
  for (const state of ['UNSETTLED', 'SETTLED', 'COMPENSATED', 'CONFLICT']) {
    assert.ok(domain.includes(`'${state}'`), `missing state ${state}`);
  }
  assert.match(domain, /row\.amountMinor !== input\.deltaMinor/);
  assert.match(domain, /compensation\.sourceProviderReference !== adjustment\.providerReference/);
  assert.match(domain, /buildRentalBookingCommercialAmendmentSettlementRequestFingerprint/);
});

test('product surface remains truthful while commercial orchestration is withheld', () => {
  assert.match(docs, /still not exposed as a staff primary action/i);
  assert.match(docs, /can now be consumed only by `applyRentalBookingCommercialAmendment`/);
  assert.match(docs, /No route or primary staff action exposes settlement yet/i);
  if (page) {
    assert.doesNotMatch(page, /recordRentalBookingCommercialAmendmentManualSettlement/);
    assert.doesNotMatch(page, /commercial-amendment-settlement/);
  }
});
