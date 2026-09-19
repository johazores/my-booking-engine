import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const amendmentSchema = read('prisma/rental-booking-commercial-amendments.prisma');
const rescheduleSchema = read('prisma/rental-booking-reschedule.prisma');
const migration = read('prisma/migrations/20260918121500-rental-commercial-amendment-apply/migration.sql');
const neutralRescheduleMigration = read('prisma/migrations/20260919013000-rental-post-commercial-neutral-reschedule/migration.sql');
const effectiveCancellationMigration = read('prisma/migrations/20260918184500-rental-effective-cancellation-settlement/migration.sql');
const service = read('src/server/bookings/rental-booking-commercial-amendment-apply-service.ts');
const docs = read('docs/rental-booking-commercial-amendment-apply.md');

test('commercial amendment apply has durable terminal linkage and database settlement authority', () => {
  for (const token of [
    'APPLIED',
    'appliedRescheduleId',
    'appliedAt',
    'RentalBookingCommercialAmendmentAppliedReschedule',
  ]) assert.ok(amendmentSchema.includes(token), `missing amendment schema token: ${token}`);
  assert.match(rescheduleSchema, /appliedCommercialAmendment/);
  for (const token of [
    'rental_booking_commercial_amendments_org_applied_reschedule_key',
    'rental_booking_commercial_amendments_org_booking_applied_key',
    'sf_guard_rental_commercial_amendment_terminal_settlement',
    'adjustment_count <> 1 OR compensation_count <> 0',
    'applied_reschedule."totalMinor" IS DISTINCT FROM NEW."afterTotalMinor"',
    'applied_reschedule."targetPricingFingerprint" IS DISTINCT FROM NEW."targetPricingFingerprint"',
  ]) assert.ok(migration.includes(token), `missing apply migration token: ${token}`);
});

test('final apply rechecks tenant, permissions, locks, custody, inventory, pricing, and exact settlement', () => {
  for (const permission of [
    "permission: 'booking:manage'",
    "permission: 'availability:read'",
    "permission: 'availability:manage'",
    "permission: 'inventory:read'",
    "permission: 'pricing:read'",
    "permission: 'payment:manage'",
  ]) assert.ok(service.includes(permission), `missing permission gate: ${permission}`);
  for (const token of [
    'rentalBookingLockKey(input.organizationId, input.bookingId)',
    'commercialAmendmentSettlementLockKey(input.organizationId, input.amendmentId)',
    'rentalUnitLockKey(input.organizationId, effectiveUnitId)',
    'booking.updatedAt.getTime() !== amendment.bookingVersion.getTime()',
    "amendment.mode === 'CUSTODY_EXTENSION'",
    'findOverdueRentalCustodyUnitIds',
    'buildRentalPricingEvidence',
    'readRentalPaymentSettlementHistory',
    'deriveRentalPaymentSettlement',
    'deriveRentalBookingCommercialAmendmentSettlementState',
    "settlement.state !== 'SETTLED'",
  ]) assert.ok(service.includes(token), `missing final apply authority token: ${token}`);
});

test('final apply appends a reschedule, versions allocation/booking, and audits without rewriting original booking money', () => {
  assert.match(service, /rentalBookingReschedule\.create/);
  assert.match(service, /totalMinor: amendment\.afterTotalMinor/);
  assert.match(service, /rentalBookingAllocation\.updateMany/);
  assert.match(service, /rentalBooking\.updateMany/);
  assert.match(service, /data: \{ updatedAt: appliedAt \}/);
  assert.match(service, /rentalBooking\.updateMany\([\s\S]*data: \{ updatedAt: appliedAt \}/);
  assert.match(service, /status: 'APPLIED'/);
  assert.match(service, /appliedRescheduleId: reschedule\.id/);
  assert.match(service, /booking\.rental\.commercial-amendment\.applied/);
});

test('one-amendment boundary permits later neutral dates while keeping price-changing writes closed', () => {
  for (const token of [
    'sf_guard_rental_commercial_amendment_chain',
    'sf_guard_rental_payment_after_commercial_amendment',
  ]) assert.ok(migration.includes(token), `missing post-apply fail-closed guard: ${token}`);
  assert.match(neutralRescheduleMigration, /CREATE OR REPLACE FUNCTION sf_guard_rental_reschedule_after_commercial_amendment/);
  assert.match(neutralRescheduleMigration, /post-amendment rental reschedule must preserve the accepted effective commercial total/);
  assert.match(neutralRescheduleMigration, /sf_guard_rental_prepared_commercial_reschedule_terminal/);
  assert.match(effectiveCancellationMigration, /DROP FUNCTION IF EXISTS sf_guard_rental_booking_cancellation_after_commercial_amendment/);
  assert.match(effectiveCancellationMigration, /rental_booking_effective_refund_transactions/);
  assert.match(effectiveCancellationMigration, /effective settlement to be fully refunded first/);
  assert.match(docs, /one applied price-changing amendment per rental/i);
  assert.match(docs, /later same-unit price-neutral reschedules\/extensions/i);
  assert.match(docs, /second price-changing amendment remains unsupported/i);
  assert.match(docs, /Post-apply cancellation/i);
  assert.match(docs, /exact zero/i);
});
