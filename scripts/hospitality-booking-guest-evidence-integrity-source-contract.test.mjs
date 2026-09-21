import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const migration = read('prisma/migrations/20260922003000-hospitality-booking-guest-evidence-integrity/migration.sql');
const guestService = read('src/server/bookings/hospitality-booking-guest-modification-service.ts');
const integrityDocs = read('docs/hospitality-booking-guest-evidence-integrity.md');
const sourceEvidenceDocs = read('docs/hospitality-booking-source-evidence-integrity.md');

test('every retained hospitality booking must have guest evidence at commit', () => {
  assert.match(migration, /existing hospitality booking is missing retained guest evidence/);
  assert.match(migration, /sf_require_hospitality_booking_guest_evidence/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER hospitality_bookings_guest_evidence_guard/);
  assert.match(migration, /AFTER INSERT ON "hospitality_bookings"/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /hospitality booking must retain guest evidence/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER hospitality_booking_guests_deletion_guard/);
  assert.match(migration, /AFTER DELETE ON "hospitality_booking_guests"/);
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

test('documentation keeps traveler replacement separate from retained terminal evidence', () => {
  assert.match(integrityDocs, /retained booking must never end a transaction with no guest evidence/i);
  assert.match(integrityDocs, /confirmed-booking traveler replacement remains compatible/i);
  assert.match(integrityDocs, /Once the owning booking is `CANCELLED`, the final traveler snapshot is terminal history/i);
  assert.match(sourceEvidenceDocs, /guest evidence/i);
  assert.match(sourceEvidenceDocs, /hospitality-booking-guest-evidence-integrity\.md/);
});
