import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const schema = read('prisma/rental-booking-early-return-release.prisma');
const inventorySchema = read('prisma/rental-inventory.prisma');
const fulfillmentSchema = read('prisma/rental-booking-fulfillment.prisma');
const migration = read('prisma/migrations/20260916043000_rental_booking_early_return_release/migration.sql');
const domain = read('src/server/bookings/rental-booking-early-return-release-domain.ts');
const service = read('src/server/bookings/rental-booking-early-return-release-service.ts');
const readService = read('src/server/bookings/rental-booking-read-service.ts');
const route = read('app/api/inventory/rentals/bookings/[booking-id]/inventory-release/route.ts');
const listPage = read('app/inventory/rentals/bookings/page.tsx');
const detailPage = read('app/inventory/rentals/bookings/[booking-id]/page.tsx');
const documentation = read('docs/rental-early-return-inventory-release.md');

test('early-return release evidence is tenant-owned append-only custody-linked persistence', () => {
  for (const token of [
    'model RentalBookingEarlyReturnRelease {',
    'rental_booking_early_return_releases_org_booking_key',
    'rental_booking_early_return_releases_org_return_event_key',
    'rental_booking_early_return_releases_booking_fkey',
    'rental_booking_early_return_releases_unit_fkey',
    'rental_booking_early_return_releases_return_event_fkey',
    'sf_guard_rental_booking_early_return_release_insert',
    'sf_guard_rental_booking_early_return_release_append_only',
    'DEFERRABLE INITIALLY DEFERRED',
  ]) assert.ok(`${schema}\n${migration}`.includes(token), token);

  assert.match(inventorySchema, /earlyReturnRelease\s+RentalBookingEarlyReturnRelease\?/);
  assert.match(inventorySchema, /earlyReturnReleases\s+RentalBookingEarlyReturnRelease\[\]\s+@relation\("RentalBookingEarlyReturnReleaseUnit"\)/);
  assert.match(fulfillmentSchema, /earlyReturnRelease\s+RentalBookingEarlyReturnRelease\?\s+@relation\("RentalBookingEarlyReturnReleaseReturnEvent"\)/);
});

test('release writer derives immutable authority, serializes booking and unit, and shortens allocation exactly once', () => {
  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /permission: 'inventory:manage'/);
  assert.match(service, /rentalBookingLockKey\(input\.organizationId, input\.bookingId\)/);
  assert.match(service, /rentalUnitLockKey\(input\.organizationId, effectiveUnitId\)/);
  assert.match(service, /clock_timestamp\(\)/);
  assert.match(service, /deriveRentalBookingFulfillmentState\(history\)/);
  assert.match(service, /fulfillment\.state !== 'RETURNED'/);
  assert.match(service, /deriveRentalBookingEarlyReturnReleaseEndsOn/);
  assert.match(service, /rentalBookingEarlyReturnReleaseIdempotencyKey\(input\.bookingId\)/);
  assert.match(service, /rentalBookingAllocation\.updateMany/);
  assert.match(service, /endsOn: committedEndsOn/);
  assert.match(service, /data: \{ endsOn: releasedEndsOn \}/);
  assert.match(service, /allocationUpdate\.count !== 1/);
  assert.match(service, /booking\.rental\.inventory-released-early/);
  assert.doesNotMatch(service, /paymentTransaction|totalMinor|currency|refund/i);
});

test('idempotent release replay revalidates assignment, exact return evidence, and live allocation', () => {
  assert.match(service, /if \(existing\)/);
  assert.match(service, /existing\.unitId !== effectiveUnitId/);
  assert.match(service, /sameDate\(existing\.committedStartsOn, committedStartsOn\)/);
  assert.match(service, /sameDate\(existing\.committedEndsOn, committedEndsOn\)/);
  assert.match(service, /id: existing\.returnEventId/);
  assert.match(service, /kind: 'RETURNED'/);
  assert.match(service, /returnEvent\.occurredAt\.getTime\(\) !== existing\.returnedAt\.getTime\(\)/);
  assert.match(service, /sameDate\(allocation\.endsOn, existing\.releasedEndsOn\)/);
  assert.match(service, /Existing early-return release evidence no longer matches the retained return custody event/);
});

test('database guards allow only whole-day post-return release and keep committed booking evidence unchanged', () => {
  assert.match(migration, /event\."kind" = 'RETURNED'/);
  assert.match(migration, /return_event\."unitId" <> expected_unit_id/);
  assert.match(migration, /expected_released_ends_on := GREATEST/);
  assert.match(migration, /AT TIME ZONE parent_booking\.location_time_zone/);
  assert.match(migration, /expected_starts_on \+ 1/);
  assert.match(migration, /NEW\."releasedEndsOn" <> expected_released_ends_on/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION sf_guard_rental_booking_allocation/);
  assert.match(migration, /expected_allocation_ends_on := COALESCE/);
  assert.match(migration, /rental_booking_early_return_releases_require_allocation_guard/);
  assert.doesNotMatch(migration, /UPDATE\s+"rental_bookings"/i);
});

test('staff route accepts no browser-controlled inventory release authority and UI distinguishes commitment from protection', () => {
  assert.match(route, /prepareInventoryMutationRequest\(request, 'booking\.rental\.inventory-release'\)/);
  assert.match(route, /organizationId: organization\.id/);
  assert.match(route, /actorUserId: session\.user\.id/);
  assert.doesNotMatch(route, /request\.json\(|request\.formData\(/);

  assert.match(readService, /earlyReturnRelease/);
  assert.match(readService, /deriveRentalBookingFulfillmentState/);
  assert.match(detailPage, /Release remaining inventory/);
  assert.match(detailPage, /Committed rental period/);
  assert.match(detailPage, /Live inventory protection/);
  assert.match(detailPage, /Return does not release inventory before the booking's effective end date by itself/);
  assert.match(listPage, /booking\.fulfillment\.state === 'AWAITING_PICKUP'/);
  assert.match(listPage, /Inventory released after early return/);
  assert.match(documentation, /does not refund, reprice, shorten the customer's committed rental period, or create an inspection outcome/i);
});
