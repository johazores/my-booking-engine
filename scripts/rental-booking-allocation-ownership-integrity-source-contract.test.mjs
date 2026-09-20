import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const migration = read('prisma/migrations/20260920150000-rental-booking-allocation-ownership-integrity/migration.sql');
const integration = read('src/server/bookings/rental-booking-source-evidence.integration.ts');
const docs = read('docs/rental-booking-source-evidence-integrity.md');

test('confirmed booking allocation ownership cannot be reassigned', () => {
  assert.match(migration, /existing confirmed rental booking is missing physical allocation evidence/);
  assert.match(migration, /sf_guard_rental_booking_allocation_owner_identity/);
  assert.match(migration, /NEW\."organizationId" IS DISTINCT FROM OLD\."organizationId"/);
  assert.match(migration, /NEW\."bookingId" IS DISTINCT FROM OLD\."bookingId"/);
  assert.match(migration, /rental booking allocation ownership is immutable/);
  assert.match(migration, /BEFORE UPDATE OF "organizationId", "bookingId"/);
});

test('confirmed booking cannot lose its physical allocation at transaction commit', () => {
  assert.match(migration, /sf_guard_confirmed_rental_booking_allocation_retention/);
  assert.match(migration, /booking\."organizationId" = OLD\."organizationId"/);
  assert.match(migration, /booking\."id" = OLD\."bookingId"/);
  assert.match(migration, /booking\."status" = 'CONFIRMED'/);
  assert.match(migration, /confirmed rental booking must retain physical allocation evidence/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER rental_booking_allocations_confirmed_retention_guard/);
  assert.match(migration, /AFTER DELETE ON "rental_booking_allocations"/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
});

test('guarded database scenario covers direct owner rewrite and allocation deletion', () => {
  assert.match(integration, /rental booking allocation ownership is immutable/i);
  assert.match(integration, /confirmed rental booking must retain physical allocation evidence/i);
  assert.match(integration, /rentalBookingAllocation\.delete\(\{/);
  assert.match(integration, /rentalBookingAllocation\.update\(\{/);
  assert.match(integration, /db\.\$transaction\(async \(transaction\) => \{/);
  assert.match(integration, /transaction\.rentalBookingAllocation\.deleteMany/);
  assert.match(integration, /transaction\.rentalBooking\.deleteMany/);
});

test('documentation distinguishes immutable allocation ownership from supported live allocation changes', () => {
  assert.match(docs, /confirmed booking cannot commit without one physical allocation/i);
  assert.match(docs, /allocation ownership.*immutable/i);
  assert.match(docs, /reschedule, unit-substitution, and early-return/i);
  assert.match(docs, /GitHub Actions are not used/i);
});
