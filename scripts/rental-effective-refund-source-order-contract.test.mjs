import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const domain = read('src/server/bookings/rental-booking-effective-settlement-domain.ts');
const migration = read('prisma/migrations/20261012073000-rental-effective-refund-source-order/migration.sql');
const authorityMigration = read('prisma/migrations/20260918173000_rental_post_apply_effective_refunds/migration.sql');

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
  const authorityTrigger = authorityMigration.match(
    /CREATE TRIGGER (\w+)\s+BEFORE INSERT OR UPDATE OR DELETE ON "rental_booking_effective_refund_transactions"/,
  )?.[1];
  const sourceOrderTrigger = migration.match(
    /CREATE TRIGGER (\w+)\s+BEFORE INSERT ON "rental_booking_effective_refund_transactions"/,
  )?.[1];
  assert.ok(authorityTrigger, 'original refund authority trigger must be installed');
  assert.ok(sourceOrderTrigger, 'source-order trigger must be installed');
  assert.ok(authorityTrigger < sourceOrderTrigger, 'booking lock must precede source-order check');
  assert.ok(Buffer.byteLength(sourceOrderTrigger, 'utf8') <= 63, 'trigger name must fit PostgreSQL identifier limit');
});

test('history reader rechecks tenant-owned amendment authority and chronological source order', () => {
  const history = read('src/server/bookings/rental-booking-effective-refund-history.ts');
  assert.match(history, /validateRentalEffectiveRefundSourceOrder/);
  assert.match(history, /rentalBookingCommercialAmendment\.findFirst/);
  assert.match(history, /organizationId: input\.organizationId/);
  assert.match(history, /chronologicalRows\.push/);
  assert.match(history, /select: \{ direction: true, deltaMinor: true, appliedAt: true \}/);
  assert.match(history, /row\.providerReference !== row\.providerReference\.trim\(\)/);
  assert.match(history, /row\.sourceProviderReference !== row\.sourceProviderReference\.trim\(\)/);
  assert.match(history, /row\.sourceProviderReference === row\.providerReference/);
  assert.match(history, /row\.providerReference\.startsWith\('sf_claim_'\)/);
  assert.match(history, /row\.sourceProviderReference\.startsWith\('sf_claim_'\)/);
  assert.match(history, /row\.createdAt\.getTime\(\) < amendment\.appliedAt\.getTime\(\)/);
  assert.doesNotMatch(history, /input\.appliedAt/);
  assert.equal((history.match(/return completeHistory\(\)/g) ?? []).length, 2);
});
