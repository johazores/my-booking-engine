import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const ownershipMigration = read('prisma/migrations/20260920150000-rental-booking-allocation-ownership-integrity/migration.sql');
const terminalRetentionMigration = read('prisma/migrations/20260920152000-rental-booking-allocation-terminal-retention/migration.sql');
const identityEvidenceMigration = read('prisma/migrations/20260920162000-rental-booking-allocation-identity-retention/migration.sql');
const integration = read('src/server/bookings/rental-booking-source-evidence.integration.ts');
const docs = read('docs/rental-booking-source-evidence-integrity.md');

test('booking allocation ownership cannot be reassigned', () => {
  assert.match(ownershipMigration, /existing confirmed rental booking is missing physical allocation evidence/);
  assert.match(ownershipMigration, /sf_guard_rental_booking_allocation_owner_identity/);
  assert.match(ownershipMigration, /NEW\."organizationId" IS DISTINCT FROM OLD\."organizationId"/);
  assert.match(ownershipMigration, /NEW\."bookingId" IS DISTINCT FROM OLD\."bookingId"/);
  assert.match(ownershipMigration, /rental booking allocation ownership is immutable/);
  assert.match(ownershipMigration, /BEFORE UPDATE OF "organizationId", "bookingId"/);
});

test('booking allocation durable row identity and creation evidence are immutable', () => {
  assert.match(identityEvidenceMigration, /sf_guard_rental_booking_allocation_identity_evidence/);
  assert.match(identityEvidenceMigration, /NEW\."id" IS DISTINCT FROM OLD\."id"/);
  assert.match(identityEvidenceMigration, /NEW\."createdAt" IS DISTINCT FROM OLD\."createdAt"/);
  assert.match(identityEvidenceMigration, /rental booking allocation identity evidence is immutable/);
  assert.match(identityEvidenceMigration, /BEFORE UPDATE OF "id", "createdAt"/);
});

test('all retained bookings keep physical allocation evidence at transaction commit', () => {
  assert.match(terminalRetentionMigration, /existing rental booking is missing retained physical allocation evidence/);
  assert.match(terminalRetentionMigration, /DROP TRIGGER IF EXISTS rental_booking_allocations_confirmed_retention_guard/);
  assert.match(terminalRetentionMigration, /DROP FUNCTION IF EXISTS sf_guard_confirmed_rental_booking_allocation_retention/);
  assert.match(terminalRetentionMigration, /sf_guard_rental_booking_allocation_retention/);
  assert.match(terminalRetentionMigration, /booking\."organizationId" = OLD\."organizationId"/);
  assert.match(terminalRetentionMigration, /booking\."id" = OLD\."bookingId"/);
  assert.doesNotMatch(terminalRetentionMigration, /booking\."status"\s*=\s*'CONFIRMED'/);
  assert.match(terminalRetentionMigration, /rental booking must retain physical allocation evidence/);
  assert.match(terminalRetentionMigration, /CREATE CONSTRAINT TRIGGER rental_booking_allocations_booking_retention_guard/);
  assert.match(terminalRetentionMigration, /AFTER DELETE ON "rental_booking_allocations"/);
  assert.match(terminalRetentionMigration, /DEFERRABLE INITIALLY DEFERRED/);
});

test('guarded database scenario covers allocation identity, ownership, and terminal retention', () => {
  assert.match(integration, /rental booking allocation ownership is immutable/i);
  assert.match(integration, /rental booking allocation identity evidence is immutable/i);
  assert.match(integration, /rental booking allocation does not match its effective confirmed unit/i);
  assert.match(integration, /rental booking must retain physical allocation evidence/i);
  assert.match(integration, /data: \{ id: crypto\.randomUUID\(\) \}/);
  assert.match(integration, /data: \{ createdAt: new Date\(/);
  assert.match(integration, /cancelRentalBooking\(\{/);
  assert.match(integration, /assert\.equal\(cancelled\.booking\.status, 'CANCELLED'\)/);
  assert.match(integration, /data: \{ endsOn: new Date\(/);
  assert.match(integration, /rentalBookingAllocation\.delete\(\{/);
  assert.match(integration, /rentalBookingAllocation\.update\(\{/);
  assert.match(integration, /db\.\$transaction\(async \(transaction\) => \{/);
  assert.match(integration, /transaction\.rentalBookingAllocation\.deleteMany/);
  assert.match(integration, /transaction\.auditEvent\.deleteMany/);
  assert.match(integration, /transaction\.rentalBooking\.deleteMany/);
});

test('documentation distinguishes fixed allocation identity from guarded live inventory authority', () => {
  assert.match(docs, /confirmed booking cannot commit without one physical allocation/i);
  assert.match(docs, /allocation ownership.*immutable/i);
  assert.match(docs, /allocation row identity.*`id`.*`createdAt`.*immutable/i);
  assert.match(docs, /including a terminal `CANCELLED` booking/i);
  assert.match(docs, /cancelled booking cannot rewrite allocation unit or date evidence/i);
  assert.match(docs, /cancellation releases live availability without deleting historical allocation evidence/i);
  assert.match(docs, /reschedule, unit-substitution, and early-return/i);
  assert.match(docs, /GitHub Actions are not used/i);
});
