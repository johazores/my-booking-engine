import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const domain = read('src/server/bookings/rental-booking-effective-settlement-domain.ts');
const migration = read('prisma/migrations/20261012073000-rental-effective-refund-source-order/migration.sql');

test('post-apply source ordering fails closed in the effective settlement domain', () => {
  assert.match(domain, /amendmentChargeRefundRemainingMinor > 0n && postApply\.bookingPriceRows\.length > 0/);
});

test('database source ordering retains tenant scope and migration preflight', () => {
  assert.match(migration, /DO \$\$/);
  assert.match(migration, /charge_refund\."createdAt" <= booking_refund\."createdAt"/);
  assert.match(migration, /refunded_charge_minor IS DISTINCT FROM amendment_delta/);
  for (const field of ['organizationId', 'bookingId', 'amendmentId']) {
    assert.ok(migration.includes(`charge_refund."${field}" = booking_refund."${field}"`));
    assert.ok(migration.includes(`charge_refund."${field}" = NEW."${field}"`));
  }
  assert.ok('rental_booking_effective_refund_transactions_authority_guard' < 'rental_effective_refund_source_order_guard');
});
