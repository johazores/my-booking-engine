import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const schema = fs.readFileSync('prisma/rental-return-inspection.prisma', 'utf8');
const migration = fs.readFileSync(
  'prisma/migrations/20260916232000_rental_return_inspections/migration.sql',
  'utf8',
);
const service = fs.readFileSync(
  'src/server/bookings/rental-return-inspection-service.ts',
  'utf8',
);
const route = fs.readFileSync(
  'app/api/inventory/rentals/bookings/[booking-id]/return-inspection/route.ts',
  'utf8',
);
const page = fs.readFileSync(
  'app/inventory/rentals/bookings/[booking-id]/page.tsx',
  'utf8',
);
const panel = fs.readFileSync(
  'src/components/rental-return-inspection-panel.tsx',
  'utf8',
);
const docs = fs.readFileSync('docs/rental-return-inspection.md', 'utf8');

test('return inspection schema is tenant-bound, idempotent, and one-per-return', () => {
  assert.match(schema, /model RentalReturnInspection/);
  assert.match(schema, /@@unique\(\[organizationId, bookingId\]/);
  assert.match(schema, /@@unique\(\[organizationId, returnEventId\]/);
  assert.match(schema, /@@unique\(\[organizationId, idempotencyKey\]/);
  assert.match(schema, /RentalBookingFulfillmentEvent/);
});

test('database authors immutable inspection evidence and quarantines non-clear units', () => {
  assert.match(migration, /kind" = 'RETURNED'/);
  assert.match(migration, /clock_timestamp\(\)/);
  assert.match(migration, /rental-return-inspection:' \|\| "bookingId"::text/);
  assert.match(migration, /inspection evidence is immutable/);
  assert.match(migration, /inspection evidence cannot be deleted/);
  assert.match(migration, /OUT_OF_SERVICE/);
  assert.match(migration, /non-clear rental return inspection requires the unit to be out of service/);
});

test('writer enforces tenant permissions, idempotency, return authority, and unit lock', () => {
  assert.match(service, /permission: 'booking:manage'/);
  assert.match(service, /permission: 'inventory:manage'/);
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /kind: 'RETURNED'/);
  assert.match(service, /const idempotencyKey = `rental-return-inspection:\$\{input\.bookingId\}`/);
  assert.match(service, /inspectionIdempotencyLockKey/);
  assert.match(service, /rentalUnitLockKey/);
  assert.match(service, /setLockedRentalUnitOperationalStatusInTransaction/);
  assert.match(service, /booking\.rental\.return-inspection-recorded/);
});

test('real route and booking UI expose the return inspection only as a persisted action', () => {
  assert.match(route, /prepareInventoryMutationRequest/);
  assert.match(route, /recordRentalReturnInspection/);
  assert.match(page, /RentalReturnInspectionPanel/);
  assert.match(panel, /readRentalReturnInspection/);
  assert.match(panel, /Record return inspection/);
  assert.match(panel, /DAMAGE_REPORTED/);
  assert.match(panel, /UNSAFE/);
  assert.doesNotMatch(route, /formField\(formData, 'idempotencyKey'\)/);
  assert.doesNotMatch(panel, /name="idempotencyKey"/);
});

test('documentation keeps damage charging and security bonds outside this foundation', () => {
  assert.match(docs, /condition-evidence boundary/);
  assert.match(docs, /security-bond/);
  assert.match(docs, /does not:/);
  assert.match(docs, /customer liability/);
});
