import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('prisma/rental-booking-reschedule.prisma', 'utf8');
const migration = readFileSync('prisma/migrations/20260915173000_rental_booking_reschedule_lifecycle/migration.sql', 'utf8');
const domain = readFileSync('src/server/bookings/rental-booking-reschedule-domain.ts', 'utf8');
const review = readFileSync('src/server/bookings/rental-booking-reschedule-authority-service.ts', 'utf8');
const writer = readFileSync('src/server/bookings/rental-booking-reschedule-service.ts', 'utf8');
const cancellation = readFileSync('src/server/bookings/rental-booking-cancellation-service.ts', 'utf8');
const readService = readFileSync('src/server/bookings/rental-booking-read-service.ts', 'utf8');
const route = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/reschedule/route.ts', 'utf8');
const page = readFileSync('app/inventory/rentals/bookings/[booking-id]/reschedule/page.tsx', 'utf8');
const detail = readFileSync('app/inventory/rentals/bookings/[booking-id]/page.tsx', 'utf8');
const list = readFileSync('app/inventory/rentals/bookings/page.tsx', 'utf8');
const docs = readFileSync('docs/rental-booking-reschedule-lifecycle.md', 'utf8');

test('reschedule evidence is append-only and database allocation authority follows the latest target', () => {
  for (const token of [
    'model RentalBookingReschedule',
    '@@unique([organizationId, idempotencyKey]',
    '@@index([organizationId, bookingId, appliedAt]',
  ]) assert.ok(schema.includes(token), `missing reschedule schema token: ${token}`);

  for (const token of [
    'rental_booking_reschedules_booking_fkey',
    'sf_guard_rental_booking_reschedule_insert',
    'sf_guard_rental_booking_reschedule_append_only',
    'sf_guard_rental_booking_allocation',
    'latest_reschedule."targetStartsOn"',
    'latest_reschedule."targetEndsOn"',
    'rental_booking_reschedules_require_allocation_guard',
    'DEFERRABLE INITIALLY DEFERRED',
  ]) assert.ok(migration.includes(token), `missing reschedule migration token: ${token}`);

  assert.match(migration, /BEFORE UPDATE OR DELETE ON "rental_booking_reschedules"/);
  assert.match(migration, /booking\."status" <> 'CONFIRMED'/);
  assert.match(migration, /allocation\."startsOn" = NEW\."targetStartsOn"/);
  assert.match(migration, /allocation\."endsOn" = NEW\."targetEndsOn"/);
});

test('review and apply use tenant permissions, shared locks, fresh inventory, pricing, and stale-authority protection', () => {
  for (const token of [
    "permission: 'booking:manage'",
    "permission: 'availability:read'",
    "permission: 'inventory:read'",
    "permission: 'pricing:read'",
    'organizationId: input.organizationId',
    "status: 'CONFIRMED'",
    'cancelledAt: null',
    'rentalBookingReschedule.findFirst',
    'sourceStartsOn',
    'sourceEndsOn',
    'sourcePricingFingerprint',
  ]) assert.ok(review.includes(token), `missing review token: ${token}`);

  for (const token of [
    "permission: 'booking:manage'",
    "permission: 'availability:read'",
    "permission: 'availability:manage'",
    "permission: 'inventory:read'",
    "permission: 'pricing:read'",
    'rentalBookingLockKey(input.organizationId, input.bookingId)',
    'rentalUnitLockKey(input.organizationId, locator.unitId)',
    'SELECT clock_timestamp() AS "now"',
    "isolationLevel: 'Serializable'",
    'bookingId: { not: booking.id }',
    'expiresAt: { gt: databaseClock.now }',
    'buildRentalPricingEvidence({',
    'buildRentalBookingRescheduleAuthorityFingerprint({',
    'requested.authorityFingerprint !== expectedAuthorityFingerprint',
    'rentalBookingReschedule.create({',
    'rentalBookingAllocation.updateMany({',
    'rentalBooking.updateMany({',
    "action: 'booking.rental.rescheduled'",
  ]) assert.ok(writer.includes(token), `missing writer token: ${token}`);

  assert.match(domain, /version: 2/);
  assert.match(domain, /sourceStartsOn:/);
  assert.match(domain, /sourceEndsOn:/);
  assert.match(domain, /bookingUpdatedAt:/);
  assert.match(domain, /rental-reschedule:/);
});

test('writer preserves immutable booking evidence while changing only effective allocation and booking version', () => {
  assert.match(writer, /data: \{\s*startsOn: requested\.startsOn,\s*endsOn: requested\.endsOn,\s*\}/);
  assert.match(writer, /data: \{ updatedAt: databaseClock\.now \}/);
  assert.match(writer, /targetPricingSnapshot: toJsonInput\(targetPricing\.snapshot\)/);
  assert.match(writer, /sourcePricingFingerprint/);
  assert.match(writer, /targetPricingFingerprint: targetPricing\.fingerprint/);
  assert.match(docs, /original `RentalBooking` ownership[\s\S]*remain immutable/i);
});

test('staff route derives tenant actor and idempotency authority server-side and exposes only supported apply', () => {
  assert.match(route, /prepareInventoryMutationRequest\(request, 'booking\.rental\.reschedule'\)/);
  assert.match(route, /organizationId: organization\.id/);
  assert.match(route, /actorUserId: session\.user\.id/);
  assert.match(route, /buildRentalBookingRescheduleIdempotencyKey/);
  assert.doesNotMatch(route, /formField\(formData, 'organizationId'\)/);
  assert.doesNotMatch(route, /formField\(formData, 'actorUserId'\)/);
  assert.doesNotMatch(route, /formField\(formData, 'idempotencyKey'\)/);
  assert.match(page, /method="post"/);
  assert.match(page, /Apply reschedule/);
  assert.match(page, /authorityFingerprint/);
  assert.match(page, /canApply = canReview && hasPermission\('availability:manage'\)/);
});

test('read and cancellation paths use current effective allocation after reschedules', () => {
  assert.match(readService, /rentalBookingReschedule\.findMany/);
  assert.match(readService, /organizationId: input\.organizationId/);
  assert.match(detail, /Effective rental period/);
  assert.match(detail, /Original booking-time period/);
  assert.match(detail, /Append-only history/);
  assert.match(list, /booking\.allocation\.startsOn/);
  assert.match(list, /booking\.allocation\.endsOn/);
  assert.match(cancellation, /rentalBookingReschedule\.findFirst/);
  assert.match(cancellation, /effectiveStartsOn/);
  assert.match(cancellation, /effectiveEndsOn/);
  assert.match(cancellation, /latestRescheduleId/);
});
