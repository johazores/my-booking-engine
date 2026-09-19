import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('availability-block creation mirrors booking conflict authority under the unit lock', async () => {
  const service = await source('src/server/inventory/rental-service.ts');
  const start = service.indexOf('export async function createRentalAvailabilityBlock');
  assert.ok(start >= 0, 'createRentalAvailabilityBlock must exist');
  const remainder = service.slice(start);
  const next = remainder.indexOf('\nexport async function ', 1);
  const createBlock = next >= 0 ? remainder.slice(0, next) : remainder;

  const lockIndex = createBlock.indexOf('await lockRentalUnit');
  const bookingQueryIndex = createBlock.indexOf('transaction.rentalBookingAllocation.findFirst');
  const conflictIndex = createBlock.indexOf('if (overlappingBooking)');
  const createIndex = createBlock.indexOf('transaction.rentalAvailabilityBlock.create');

  assert.ok(lockIndex >= 0, 'block creation must acquire the shared physical-unit lock');
  assert.ok(bookingQueryIndex > lockIndex, 'booking overlap must be read after serialization');
  assert.ok(conflictIndex > bookingQueryIndex, 'booking overlap must be interpreted as a domain conflict');
  assert.ok(createIndex > conflictIndex, 'block write must happen after the conflict check');
  assert.match(createBlock, /organizationId: input\.organizationId/);
  assert.match(createBlock, /unitId: block\.unitId/);
  assert.match(createBlock, /startsOn: \{ lt: block\.endsOn \}/);
  assert.match(createBlock, /endsOn: \{ gt: block\.startsOn \}/);
  assert.match(createBlock, /status: \{ not: 'CANCELLED' \}/);
  assert.match(createBlock, /Resolve the overlapping rental booking before adding this unavailable-date block/);
});

test('database availability-block guard remains an independent direct-write backstop', async () => {
  const migration = await source('prisma/migrations/20260919182000-rental-hold-trigger-wall-clock/migration.sql');
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION sf_guard_rental_block_against_holds()');
  assert.ok(start >= 0, 'rental block guard must exist');
  const remainder = migration.slice(start);
  const next = remainder.indexOf('\nCREATE OR REPLACE FUNCTION ', 1);
  const guard = next >= 0 ? remainder.slice(0, next) : remainder;

  const lockIndex = guard.indexOf('pg_advisory_xact_lock');
  const bookingIndex = guard.indexOf('FROM "rental_booking_allocations" allocation');
  assert.ok(lockIndex >= 0, 'database block guard must share the physical-unit lock');
  assert.ok(bookingIndex > lockIndex, 'database booking overlap check must run after serialization');
  assert.match(guard, /allocation\."organizationId" = NEW\."organizationId"/);
  assert.match(guard, /allocation\."unitId" = NEW\."unitId"/);
  assert.match(guard, /booking\."status" <> 'CANCELLED'/);
  assert.match(guard, /allocation\."startsOn" < NEW\."endsOn"/);
  assert.match(guard, /allocation\."endsOn" > NEW\."startsOn"/);
  assert.match(guard, /rental unavailable-date block overlaps an active booking/);
});

test('availability-block conflict authority is documented as application feedback plus database enforcement', async () => {
  const docs = await source('docs/rental-availability-block-booking-authority.md');
  assert.match(docs, /tenant-scoped/i);
  assert.match(docs, /shared physical-unit lock/i);
  assert.match(docs, /non-cancelled booking allocation/i);
  assert.match(docs, /PostgreSQL/i);
  assert.match(docs, /GitHub Actions are not required or used/);
});
