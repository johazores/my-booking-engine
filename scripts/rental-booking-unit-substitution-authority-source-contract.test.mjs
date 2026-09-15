import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [domain, service, page, docs] = await Promise.all([
  read('src/server/bookings/rental-booking-unit-substitution-domain.ts'),
  read('src/server/bookings/rental-booking-unit-substitution-authority-service.ts'),
  read('app/inventory/rentals/bookings/[booking-id]/unit-substitution/page.tsx'),
  read('docs/rental-booking-unit-substitution-authority.md'),
]);

test('unit substitution authority binds durable booking and physical assignment evidence', () => {
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
  ]) {
    assert.match(domain, new RegExp(token));
  }
  assert.match(domain, /version:\s*1/);
  assert.match(domain, /createHash\('sha256'\)/);
});

test('candidate search is bounded, tenant-scoped, and restricted to same type and location', () => {
  assert.match(service, /permission:\s*'booking:manage'/);
  assert.match(service, /permission:\s*'inventory:read'/);
  assert.match(service, /organizationId:\s*input\.organizationId/);
  assert.match(service, /unitTypeId:\s*booking\.unitTypeId/);
  assert.match(service, /locationId:\s*booking\.locationId/);
  assert.match(service, /id:\s*\{\s*not:\s*booking\.unitId\s*\}/);
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

test('staff surface is read-only and does not pretend substitution is implemented', () => {
  assert.match(page, /Review replacement unit/);
  assert.match(page, /read-only preflight/i);
  assert.match(page, /does not reserve the target unit/i);
  assert.doesNotMatch(page, /method="post"/i);
  assert.doesNotMatch(page, />Apply substitution</i);
  assert.doesNotMatch(page, /\/api\/inventory\/rentals\/bookings\/.*unit-substitution/);
  assert.match(docs, /append-only substitution evidence/i);
  assert.match(docs, /No POST route or Apply button exists\./);
});
