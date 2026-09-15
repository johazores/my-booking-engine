import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const domain = readFileSync('src/server/bookings/rental-booking-reschedule-domain.ts', 'utf8');
const service = readFileSync('src/server/bookings/rental-booking-reschedule-authority-service.ts', 'utf8');
const bookingMigration = readFileSync('prisma/migrations/20260915123000_rental_booking_foundation/migration.sql', 'utf8');
const docs = readFileSync('docs/rental-booking-reschedule-authority.md', 'utf8');
const page = readFileSync('app/inventory/rentals/bookings/[booking-id]/reschedule/page.tsx', 'utf8');
const detailPage = readFileSync('app/inventory/rentals/bookings/[booking-id]/page.tsx', 'utf8');

test('rental reschedule review is tenant-scoped and permission-checked', () => {
  for (const token of [
    "permission: 'booking:manage'",
    "permission: 'availability:read'",
    "permission: 'inventory:read'",
    "permission: 'pricing:read'",
    'id: input.bookingId',
    'organizationId: input.organizationId',
    "status: 'CONFIRMED'",
    'cancelledAt: null',
    'include: {',
    'allocation: true',
  ]) assert.ok(service.includes(token), `missing reschedule review authority token: ${token}`);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(service, /SELECT clock_timestamp\(\) AS "now"/);
});

test('review excludes only the source allocation and revalidates target inventory and pricing', () => {
  for (const token of [
    'unitId: booking.unitId',
    'bookingId: { not: booking.id }',
    "status: 'ACTIVE'",
    'expiresAt: { gt: databaseClock.now }',
    'startsOn: { lt: target.endsOn }',
    'endsOn: { gt: target.startsOn }',
    'buildRentalPricingEvidence({',
    'BigInt(targetPricing.totalMinor) !== booking.totalMinor',
    "blocker = 'INVENTORY_CONFLICT'",
    "blocker = 'PRICE_CHANGED'",
    "blocker = 'NO_CHANGE'",
  ]) assert.ok(service.includes(token), `missing reschedule inventory/pricing token: ${token}`);
});

test('reschedule authority fingerprint binds source version and target commercial evidence', () => {
  for (const token of [
    'bookingUpdatedAt',
    'sourcePricingFingerprint',
    'targetPricingFingerprint',
    'startsOn',
    'endsOn',
    'totalMinor',
    "createHash('sha256')",
  ]) assert.ok(domain.includes(token), `missing reschedule fingerprint token: ${token}`);
  assert.match(service, /bookingUpdatedAt: booking\.updatedAt/);
  assert.match(service, /sourcePricingFingerprint: booking\.pricingFingerprint/);
  assert.match(service, /targetPricingFingerprint: targetPricing\.fingerprint/);
});

test('authority review stays read-only while immutable booking evidence remains protected', () => {
  assert.doesNotMatch(service, /rentalBooking\.(?:create|update|updateMany|delete|deleteMany)\(/);
  assert.doesNotMatch(service, /rentalBookingAllocation\.(?:create|update|updateMany|delete|deleteMany)\(/);
  assert.doesNotMatch(service, /rentalAvailabilityHold\.(?:create|update|updateMany|delete|deleteMany)\(/);
  assert.match(bookingMigration, /sf_guard_rental_booking_immutable_evidence/);
  assert.match(docs, /does not mutate/i);
  assert.match(docs, /same physical unit/i);
  assert.match(docs, /price-neutral/i);
});

test('staff UI exposes an explicit read-only reschedule preflight without a dead mutation action', () => {
  assert.match(detailPage, /Reschedule preflight/);
  assert.match(detailPage, /\/reschedule/);
  assert.match(page, /reviewRentalBookingRescheduleAuthority/);
  assert.match(page, /method="get"/);
  assert.match(page, /Review target dates/);
  assert.match(page, /does not reserve new inventory and does not mutate/i);
  assert.doesNotMatch(page, /method="post"/);
  assert.doesNotMatch(page, /Apply reschedule|Confirm reschedule|Save reschedule/i);
});
