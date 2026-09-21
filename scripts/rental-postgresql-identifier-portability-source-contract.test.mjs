import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const damageSettlementSchema = read('prisma/rental-damage-settlement.prisma');
const lateReturnSchema = read('prisma/rental-late-return-settlement.prisma');
const effectiveRefundSchema = read('prisma/rental-booking-effective-refunds.prisma');
const migration = read('prisma/migrations/20260922064500-rental-identifier-portability/migration.sql');

const byteLength = (name) => Buffer.byteLength(name, 'utf8');

const expectedRenames = new Map([
  ['rental_damage_settlement_transactions_org_provider_reference_ke', 'rental_damage_settlement_org_provider_ref_key'],
  ['rental_late_return_settlement_transactions_org_provider_referen', 'rental_late_return_settlement_org_provider_ref_key'],
  ['rental_late_return_settlement_transactions_org_assessment_kind_', 'rental_late_return_settlement_org_assessment_kind_key'],
  ['rental_booking_effective_refund_transactions_org_idempotency_ke', 'rental_effective_refund_org_idempotency_key'],
  ['rental_booking_effective_refund_transactions_org_provider_refer', 'rental_effective_refund_org_provider_ref_key'],
  ['rental_booking_effective_refund_transactions_booking_created_id', 'rental_effective_refund_booking_created_idx'],
  ['rental_booking_effective_refund_transactions_source_reference_i', 'rental_effective_refund_source_reference_idx'],
  ['rental_damage_settlement_transactions_cross_scope_reference_gua', 'rental_damage_settlement_cross_scope_reference_guard'],
  ['rental_late_return_settlement_transactions_cross_scope_referenc', 'rental_late_return_settlement_cross_scope_reference_guard'],
  ['rental_booking_commercial_amendment_settlement_transactions_cro', 'rental_amendment_settlement_cross_scope_reference_guard'],
  ['rental_booking_effective_refund_transactions_cross_scope_refere', 'rental_effective_refund_cross_scope_reference_guard'],
  ['rental_late_return_settlement_transactions_register_manual_refe', 'rental_late_return_settlement_register_manual_reference'],
  ['rental_booking_commercial_amendment_settlement_transactions_reg', 'rental_amendment_settlement_register_manual_reference'],
  ['rental_booking_effective_refund_transactions_register_manual_re', 'rental_effective_refund_register_manual_reference'],
  ['rental_bookings_prepared_commercial_amendment_cancellation_guar', 'rental_bookings_prepared_amendment_cancel_guard'],
]);

test('corrective migration uses the exact 63-byte PostgreSQL legacy identifiers', () => {
  for (const [legacyName, portableName] of expectedRenames) {
    assert.equal(byteLength(legacyName), 63, `${legacyName} must be the exact stored legacy identifier`);
    assert.match(migration, new RegExp(`"${legacyName}"[\\s\\S]*RENAME TO "${portableName}"`));
  }
});

test('all replacement identifiers fit PostgreSQL and remain unique', () => {
  const portableNames = [...expectedRenames.values()];
  assert.equal(new Set(portableNames).size, portableNames.length);
  for (const name of portableNames) {
    assert.ok(byteLength(name) <= 63, `${name} exceeds PostgreSQL identifier length`);
  }
});


test('damage-settlement Prisma mappings use portable final database names', () => {
  const mappedNames = [...damageSettlementSchema.matchAll(/map:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(mappedNames.length >= 9);
  for (const name of mappedNames) {
    assert.ok(byteLength(name) <= 63, `${name} exceeds PostgreSQL identifier length`);
  }
  assert.match(damageSettlementSchema, /rental_damage_settlement_org_provider_ref_key/);
  assert.doesNotMatch(damageSettlementSchema, /rental_damage_settlement_transactions_org_provider_reference_key/);
});

test('late-return settlement Prisma mappings use portable final database names', () => {
  const mappedNames = [...lateReturnSchema.matchAll(/map:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(mappedNames.length >= 7);
  for (const name of mappedNames) {
    assert.ok(byteLength(name) <= 63, `${name} exceeds PostgreSQL identifier length`);
  }
  assert.match(lateReturnSchema, /rental_late_return_settlement_org_provider_ref_key/);
  assert.match(lateReturnSchema, /rental_late_return_settlement_org_assessment_kind_key/);
  assert.doesNotMatch(lateReturnSchema, /rental_late_return_settlement_transactions_org_provider_reference_key/);
  assert.doesNotMatch(lateReturnSchema, /rental_late_return_settlement_transactions_org_assessment_kind_key/);
});

test('effective-refund Prisma mappings use portable final database names', () => {
  const mappedNames = [...effectiveRefundSchema.matchAll(/map:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(mappedNames.length >= 6);
  for (const name of mappedNames) {
    assert.ok(byteLength(name) <= 63, `${name} exceeds PostgreSQL identifier length`);
  }
  for (const name of [
    'rental_effective_refund_org_idempotency_key',
    'rental_effective_refund_org_provider_ref_key',
    'rental_effective_refund_booking_created_idx',
    'rental_effective_refund_source_reference_idx',
  ]) assert.match(effectiveRefundSchema, new RegExp(name));
});

test('migration retains table scope while renaming trigger objects only', () => {
  for (const table of [
    'rental_damage_settlement_transactions',
    'rental_late_return_settlement_transactions',
    'rental_booking_commercial_amendment_settlement_transactions',
    'rental_booking_effective_refund_transactions',
    'rental_bookings',
  ]) assert.match(migration, new RegExp(`ON "${table}"`));

  assert.doesNotMatch(migration, /CREATE TRIGGER|DROP TRIGGER|DROP INDEX|DROP TABLE/);
});
