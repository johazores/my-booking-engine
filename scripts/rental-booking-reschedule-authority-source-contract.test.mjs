import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const domain = readFileSync('src/server/bookings/rental-booking-reschedule-domain.ts', 'utf8');
const service = readFileSync('src/server/bookings/rental-booking-reschedule-authority-service.ts', 'utf8');
const docs = readFileSync('docs/rental-booking-reschedule-authority.md', 'utf8');
const page = readFileSync('app/inventory/rentals/bookings/[booking-id]/reschedule/page.tsx', 'utf8');
const detailPage = readFileSync('app/inventory/rentals/bookings/[booking-id]/page.tsx', 'utf8');

test('rental reschedule review is tenant-scoped and permission-checked', () => {
  for (const token of [
    "permission: 'booking:manage'", "permission: 'availability:read'", "permission: 'inventory:read'", "permission: 'pricing:read'",
    'id: input.bookingId', 'organizationId: input.organizationId', "status: 'CONFIRMED'", 'cancelledAt: null',
    'rentalBookingReschedule.findFirst', 'rentalBookingUnitSubstitution.findFirst',
  ]) assert.ok(service.includes(token), `missing reschedule review authority token: ${token}`);
  assert.match(service, /isolationLevel: 'Serializable'/);
  assert.match(service, /SELECT clock_timestamp\(\) AS "now"/);
});

test('review uses current effective unit, excludes only source booking, and rebuilds target pricing', () => {
  for (const token of [
    'effectiveUnitId', 'bookingId: { not: booking.id }', "status: 'ACTIVE'", 'expiresAt: { gt: databaseClock.now }',
    'startsOn: { lt: target.endsOn }', 'endsOn: { gt: target.startsOn }', 'buildRentalPricingEvidence({',
    'buildRentalBookingRescheduleCommercialImpact({', "blocker = 'INVENTORY_CONFLICT'", "blocker = 'PRICE_CHANGED'", "blocker = 'NO_CHANGE'",
  ]) assert.ok(service.includes(token), `missing reschedule inventory/pricing token: ${token}`);
});

test('review refuses dead date-change actions while a prepared or applied commercial amendment exists', () => {
  assert.match(service, /rentalBookingCommercialAmendment\.findFirst/);
  assert.match(service, /status: \{ in: \['PREPARED', 'APPLIED'\] \}/);
  assert.match(service, /COMMERCIAL_AMENDMENT_ACTIVE/);
  assert.match(service, /COMMERCIAL_AMENDMENT_APPLIED/);
  assert.match(service, /existingCommercialAmendment\?\.status === 'APPLIED'/);
  assert.match(service, /existingCommercialAmendment\?\.status === 'PREPARED'/);
  assert.match(page, /Open existing commercial amendment/);
});

test('reschedule authority fingerprint binds current effective source version and target commercial evidence', () => {
  for (const token of [
    'bookingUpdatedAt', 'sourceStartsOn', 'sourceEndsOn', 'sourcePricingFingerprint', 'targetPricingFingerprint',
    'targetStartsOn', 'targetEndsOn', 'totalMinor', "createHash('sha256')", 'version: 3',
  ]) assert.ok(domain.includes(token), `missing reschedule fingerprint token: ${token}`);
  assert.match(service, /bookingUpdatedAt: booking\.updatedAt/);
  assert.match(service, /sourcePricingFingerprint/);
  assert.match(service, /targetPricingFingerprint: targetPricing\.fingerprint/);
  assert.match(service, /latestReschedule\?\.targetStartsOn \?\? booking\.startsOn/);
});

test('authority review itself stays read-only while durable writers remain separate server boundaries', () => {
  assert.doesNotMatch(service, /rentalBooking\.(?:create|update|updateMany|delete|deleteMany)\(/);
  assert.doesNotMatch(service, /rentalBookingAllocation\.(?:create|update|updateMany|delete|deleteMany)\(/);
  assert.doesNotMatch(service, /rentalAvailabilityHold\.(?:create|update|updateMany|delete|deleteMany)\(/);
  assert.match(docs, /review itself reserves nothing/i);
  assert.match(docs, /same-unit/i);
  assert.match(docs, /price-neutral/i);
  assert.match(docs, /commercial amendment/i);
});

test('staff UI separates price-neutral apply from price-changing commercial preparation', () => {
  assert.match(detailPage, /Reschedule rental/);
  assert.match(detailPage, /\/reschedule/);
  assert.match(page, /reviewRentalBookingRescheduleAuthority/);
  assert.match(page, /method="get"/);
  assert.match(page, /Review target dates/);
  assert.match(page, /canApply = canReview && hasPermission\('availability:manage'\)/);
  assert.match(page, /Apply reschedule/);
  assert.match(page, /authorityFingerprint/);
  assert.match(page, /commercialAmendmentFingerprint/);
  assert.match(page, /Prepare commercial amendment/);
  assert.match(page, /payment:manage/);
});
