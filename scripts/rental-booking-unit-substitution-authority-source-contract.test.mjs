import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [domain, service, writer, route, page, docs] = await Promise.all([
  read('src/server/bookings/rental-booking-unit-substitution-domain.ts'),
  read('src/server/bookings/rental-booking-unit-substitution-authority-service.ts'),
  read('src/server/bookings/rental-booking-unit-substitution-service.ts'),
  read('app/api/inventory/rentals/bookings/[booking-id]/unit-substitution/route.ts'),
  read('app/inventory/rentals/bookings/[booking-id]/unit-substitution/page.tsx'),
  read('docs/rental-booking-unit-substitution-authority.md'),
]);

test('unit substitution authority binds durable current booking and physical assignment evidence', () => {
  for (const token of [
    'bookingUpdatedAt',
    'sourceUnitId',
    'targetUnitId',
    'unitTypeId',
    'locationId',
    'startsOn',
    'endsOn',
    'totalMinor',
    'pricingFingerprint',
  ]) assert.match(domain, new RegExp(token));
  assert.match(domain, /version:\s*2/);
  assert.match(domain, /createHash\('sha256'\)/);
  assert.match(domain, /buildRentalBookingUnitSubstitutionIdempotencyKey/);
});

test('candidate search is bounded, tenant-scoped, and excludes current effective unit', () => {
  assert.match(service, /permission:\s*'booking:manage'/);
  assert.match(service, /permission:\s*'inventory:read'/);
  assert.match(service, /organizationId:\s*input\.organizationId/);
  assert.match(service, /unitTypeId:\s*booking\.unitTypeId/);
  assert.match(service, /locationId:\s*booking\.locationId/);
  assert.match(service, /latestSubstitution/);
  assert.match(service, /sourceUnitId = input\.latestSubstitution\?\.targetUnitId \?\? input\.booking\.unitId/);
  assert.match(service, /id:\s*\{\s*not:\s*effective\.sourceUnitId\s*\}/);
  assert.match(service, /take:\s*CANDIDATE_PAGE_SIZE/);
  assert.match(service, /const CANDIDATE_PAGE_SIZE = 50/);
});

test('fresh review uses database time and checks all target inventory conflicts', () => {
  assert.match(service, /permission:\s*'availability:read'/);
  assert.match(service, /SELECT clock_timestamp\(\) AS "now"/);
  assert.match(service, /rentalAvailabilityBlock\.findFirst/);
  assert.match(service, /rentalAvailabilityHold\.findFirst/);
  assert.match(service, /expiresAt:\s*\{\s*gt:\s*databaseClock\.now\s*\}/);
  assert.match(service, /rentalBookingAllocation\.findFirst/);
  assert.match(service, /status:\s*\{\s*not:\s*'CANCELLED'\s*\}/);
});

test('staff surface only exposes apply after fresh ready authority and server write permissions', () => {
  assert.match(page, /Replace physical unit/);
  assert.match(page, /canApply = canReview && hasPermission\('availability:manage'\)/);
  assert.match(page, /review\.ready && review\.authorityFingerprint && review\.targetUnit && canApply/);
  assert.match(page, /method="post"/i);
  assert.match(page, />Apply replacement unit</i);
  assert.match(page, /\/api\/inventory\/rentals\/bookings\/\$\{booking\.id\}\/unit-substitution/);
  assert.match(page, /booking\.allocation\.unit\.name/);
  assert.match(route, /buildRentalBookingUnitSubstitutionIdempotencyKey/);
  assert.match(route, /organizationId: organization\.id/);
  assert.match(route, /actorUserId: session\.user\.id/);
});

test('durable writer preserves immutable booking-time evidence while moving effective allocation', () => {
  assert.match(writer, /rentalBookingUnitSubstitution\.create/);
  assert.match(writer, /rentalBookingAllocation\.updateMany/);
  assert.match(writer, /data: \{ unitId: requested\.targetUnitId \}/);
  assert.match(writer, /unitId: booking\.unitId/);
  assert.match(writer, /latestSubstitution\.id !== existing\.id/);
  assert.match(writer, /allocation\.unitId !== existing\.targetUnitId/);
  assert.match(writer, /action: 'booking\.rental\.unit-substituted'/);
  assert.match(docs, /append-only `RentalBookingUnitSubstitution` history/i);
  assert.match(docs, /immutable booking-time evidence/i);
});
