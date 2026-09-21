import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}

const migration = read('prisma/migrations/20260921130000-rental-booking-version-clock-authority/migration.sql');
const integration = read('src/server/bookings/rental-booking-source-evidence.integration.ts');
const sourceDocs = read('docs/rental-booking-source-evidence-integrity.md');
const rescheduleDocs = read('docs/rental-booking-reschedule-lifecycle.md');
const substitutionDocs = read('docs/rental-booking-unit-substitution-authority.md');

test('PostgreSQL authors a strictly monotonic rental booking version on every update', () => {
  assert.ok(migration.includes('sf_author_rental_booking_version'));
  assert.ok(migration.includes('NEW."updatedAt" := GREATEST'));
  assert.ok(migration.includes('clock_timestamp()'));
  assert.ok(migration.includes('OLD."updatedAt" + INTERVAL \'1 microsecond\''));
  assert.ok(migration.includes('BEFORE UPDATE ON "rental_bookings"'));
  assert.ok(migration.includes('rental_bookings_version_clock_authority'));
});

test('direct caller-authored booking versions are replaced by database authority', () => {
  assert.ok(integration.includes("callerAuthoredBookingVersion = new Date('2099-01-01T00:00:00.000Z')"));
  assert.ok(integration.includes('PostgreSQL must replace caller-authored rental booking versions'));
  assert.ok(integration.includes('rental booking version must advance monotonically'));
});

test('version authority is documented where stale review fingerprints depend on updatedAt', () => {
  assert.ok(sourceDocs.includes('booking version evidence (`updatedAt`) is PostgreSQL-authored and monotonic'));
  assert.ok(sourceDocs.includes('Reschedule, substitution, cancellation, and commercial-amendment compare-and-set checks'));
  assert.ok(rescheduleDocs.includes('PostgreSQL authors that version timestamp from its wall clock'));
  assert.ok(substitutionDocs.includes('PostgreSQL-authored monotonic booking `updatedAt` version'));
});
