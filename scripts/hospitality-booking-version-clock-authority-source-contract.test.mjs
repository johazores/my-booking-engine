import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}

const migration = read('prisma/migrations/20260921203000-hospitality-booking-version-clock-authority/migration.sql');
const integration = read('src/server/bookings/hospitality-booking-version-authority.integration.ts');
const databaseRunner = read('scripts/run-database-tests.mjs');
const lifecycleDocs = read('docs/booking-lifecycle-write-scope.md');
const modificationDocs = read('docs/zero-delta-commercial-modification-write-scope.md');

test('PostgreSQL authors a strictly monotonic hospitality booking version on every update', () => {
  assert.ok(migration.includes('sf_author_hospitality_booking_version'));
  assert.ok(migration.includes('NEW."updatedAt" := GREATEST'));
  assert.ok(migration.includes('clock_timestamp()'));
  assert.ok(migration.includes('OLD."updatedAt" + INTERVAL \'1 microsecond\''));
  assert.ok(migration.includes('BEFORE UPDATE ON "hospitality_bookings"'));
  assert.ok(migration.includes('hospitality_bookings_version_clock_authority'));
});

test('guarded PostgreSQL coverage rejects caller-authored hospitality booking versions', () => {
  assert.ok(integration.includes("callerAuthoredBookingVersion = new Date('2099-01-01T00:00:00.000Z')"));
  assert.ok(integration.includes('PostgreSQL must replace caller-authored hospitality booking versions'));
  assert.ok(integration.includes('hospitality booking version must advance monotonically'));
  assert.ok(databaseRunner.includes("'src/server/bookings/hospitality-booking-version-authority.integration.ts'"));
});

test('hospitality stale-authority docs bind compare-and-set writes to database-owned versions', () => {
  assert.ok(lifecycleDocs.includes('`HospitalityBooking.updatedAt` is concurrency and stale-authority evidence'));
  assert.ok(lifecycleDocs.includes('PostgreSQL now authors that version on every booking update'));
  assert.ok(modificationDocs.includes('observed PostgreSQL-authored `updatedAt` version'));
  assert.ok(modificationDocs.includes('neither application code nor direct SQL can forge the past/future booking version'));
});
