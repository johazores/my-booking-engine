import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const migration = read('prisma/migrations/20260922003000-hospitality-booking-guest-evidence-integrity/migration.sql');
const transitionMigration = read('prisma/migrations/20260922004500-hospitality-booking-guest-terminal-transition-guard/migration.sql');
const guestService = read('src/server/bookings/hospitality-booking-guest-modification-service.ts');
const integration = read('src/server/bookings/hospitality-booking-guest-evidence-integrity.integration.ts');
const databaseRunner = read('scripts/run-database-tests.mjs');
const integrityDocs = read('docs/hospitality-booking-guest-evidence-integrity.md');
const sourceEvidenceDocs = read('docs/hospitality-booking-source-evidence-integrity.md');

test('migration chain preflights retained guest evidence and protects destructive deletion', () => {
  assert.match(migration, /existing hospitality booking is missing retained guest evidence/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER hospitality_booking_guests_deletion_guard/);
  assert.match(migration, /AFTER DELETE ON "hospitality_booking_guests"/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /hospitality booking must retain guest evidence/);
});

test('final migration state guards cancellation without constraining raw fixture insertion order', () => {
  assert.match(transitionMigration, /DROP TRIGGER hospitality_bookings_guest_evidence_guard ON "hospitality_bookings"/);
  assert.match(transitionMigration, /DROP FUNCTION sf_require_hospitality_booking_guest_evidence\(\)/);
  assert.match(transitionMigration, /sf_require_hospitality_booking_guest_evidence_for_cancellation/);
  assert.match(transitionMigration, /NEW\."status" = 'CANCELLED'/);
  assert.match(transitionMigration, /hospitality booking cancellation requires retained guest evidence/);
  assert.match(transitionMigration, /BEFORE UPDATE OF "status" ON "hospitality_bookings"/);
});

test('guest rows are replace-only and cancelled traveler history is terminal', () => {
  assert.match(migration, /hospitality booking guest rows are replace-only through the controlled traveler workflow/);
  assert.match(migration, /BEFORE UPDATE ON "hospitality_booking_guests"/);
  assert.match(migration, /sf_guard_cancelled_hospitality_booking_guest_insert/);
  assert.match(migration, /booking\."status" = 'CANCELLED'/);
  assert.match(migration, /BEFORE INSERT ON "hospitality_booking_guests"/);
  assert.match(migration, /cancelled hospitality booking guest history is immutable/);
  assert.match(migration, /booking_status = 'CANCELLED'/);
});

test('authorized traveler replacement stays atomic and compatible with deferred retention', () => {
  assert.match(guestService, /booking\.status !== 'CONFIRMED'/);
  assert.match(guestService, /requireOrganizationPermission\(\{/);
  assert.match(guestService, /permission: 'booking:manage'/);
  assert.match(guestService, /hospitalityBookingGuest\.deleteMany\(\{/);
  assert.match(guestService, /hospitalityBookingGuest\.createMany\(\{/);
  assert.match(guestService, /isolationLevel: 'Serializable'/);
});

test('guarded PostgreSQL scenario covers direct rewrites, replacement compatibility, and terminal history', () => {
  assert.match(integration, /hospitalityBookingGuest\.update\(\{/);
  assert.match(integration, /replace-only through the controlled traveler workflow/i);
  assert.match(integration, /hospitalityBookingGuest\.deleteMany\(\{/);
  assert.match(integration, /hospitality booking must retain guest evidence/i);
  assert.match(integration, /updateHospitalityBookingGuests\(\{/);
  assert.match(integration, /cancelHospitalityBooking\(\{/);
  assert.match(integration, /cancelled hospitality booking guest history is immutable/i);
  assert.match(databaseRunner, /src\/server\/bookings\/hospitality-booking-guest-evidence-integrity\.integration\.ts/);
});

test('documentation keeps traveler replacement separate from retained terminal evidence', () => {
  assert.match(integrityDocs, /retained booking with established traveler evidence must never lose its complete guest set/i);
  assert.match(integrityDocs, /confirmed-booking traveler replacement remains compatible/i);
  assert.match(integrityDocs, /cannot transition into `CANCELLED` unless retained guest evidence exists/i);
  assert.match(integrityDocs, /guarded PostgreSQL scenario/i);
  assert.match(sourceEvidenceDocs, /guest evidence/i);
  assert.match(sourceEvidenceDocs, /rejects a transition into `CANCELLED` when retained guest evidence is missing/i);
  assert.match(sourceEvidenceDocs, /hospitality-booking-guest-evidence-integrity\.md/);
});
