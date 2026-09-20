import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const writer = read('src/server/bookings/rental-booking-service.ts');
const migration = read('prisma/migrations/20260916143000_rental_booking_source_evidence_integrity/migration.sql');
const consumptionMigration = read('prisma/migrations/20260920143000-rental-hold-consumption-booking-integrity/migration.sql');
const integration = read('src/server/bookings/rental-booking-source-evidence.integration.ts');
const docs = read('docs/rental-booking-source-evidence-integrity.md');
const databaseRunner = read('scripts/run-database-tests.mjs');

test('confirmation replay revalidates retained source hold evidence instead of trusting the idempotency key alone', () => {
  for (const token of [
    "import { isDeepStrictEqual } from 'node:util'",
    'hold: {',
    "sourceHold.status === 'CONSUMED'",
    'sourceHold.endedAt !== null',
    'sourceHold.unitId === existing.unitId',
    'sourceHold.startsOn.getTime() === existing.startsOn.getTime()',
    'sourceHold.endsOn.getTime() === existing.endsOn.getTime()',
    'sourceHold.quotedCurrency === existing.currency',
    'sourceHold.quotedTotalMinor === existing.totalMinor',
    'sourceHold.pricingFingerprint === existing.pricingFingerprint',
    'isDeepStrictEqual(sourceHold.pricingSnapshot, existing.pricingSnapshot)',
    'buildRentalBookingConversionAuthorityFingerprint({',
    'holdExpiresAt: sourceHold.expiresAt',
    'existing.authorityFingerprint !== expectedAuthorityFingerprint',
  ]) {
    assert.ok(writer.includes(token), `missing replay integrity token: ${token}`);
  }
});

test('database requires the immutable booking pricing snapshot to match its retained source hold', () => {
  assert.match(migration, /sf_guard_rental_booking_source_snapshot/);
  assert.match(migration, /source_hold\."pricingObservedAt" IS NULL/);
  assert.match(migration, /source_hold\."pricingSnapshot" IS DISTINCT FROM NEW\."pricingSnapshot"/);
  assert.match(migration, /rental_bookings_source_snapshot_guard/);
});

test('a hold referenced by a rental booking cannot have source authority rewritten or deleted', () => {
  assert.match(migration, /sf_guard_booked_rental_hold_immutable/);
  assert.match(migration, /FROM "rental_bookings" booking/);
  assert.match(migration, /booking\."organizationId" = OLD\."organizationId"/);
  assert.match(migration, /booking\."holdId" = OLD\."id"/);
  assert.match(migration, /TG_OP = 'DELETE'/);
  for (const field of [
    '"unitId"',
    '"startsOn"',
    '"endsOn"',
    '"status"',
    '"expiresAt"',
    '"endedAt"',
    '"idempotencyKey"',
    '"quotedCurrency"',
    '"quotedTotalMinor"',
    '"pricingFingerprint"',
    '"pricingSnapshot"',
    '"pricingObservedAt"',
  ]) {
    assert.ok(migration.includes(`NEW.${field} IS DISTINCT FROM OLD.${field}`), `missing booked-hold immutability for ${field}`);
  }
  assert.match(migration, /rental_availability_holds_booked_evidence_guard/);
  assert.match(databaseRunner, /src\/server\/bookings\/rental-booking-source-evidence\.integration\.ts/);
});

test('consumed hold lifecycle cannot commit without same-tenant booking evidence', () => {
  assert.match(consumptionMigration, /existing consumed rental hold is missing retained booking evidence/);
  assert.match(consumptionMigration, /sf_guard_rental_hold_consumption_booking_integrity/);
  assert.match(consumptionMigration, /hold\."status"::text/);
  assert.match(consumptionMigration, /current_status <> 'CONSUMED'/);
  assert.match(consumptionMigration, /booking\."organizationId" = NEW\."organizationId"/);
  assert.match(consumptionMigration, /booking\."holdId" = NEW\."id"/);
  assert.match(consumptionMigration, /consumed rental hold must be retained by a rental booking/);
  assert.match(consumptionMigration, /CREATE CONSTRAINT TRIGGER rental_availability_holds_consumed_booking_guard/);
  assert.match(consumptionMigration, /DEFERRABLE INITIALLY DEFERRED/);

  const consumeIndex = writer.indexOf('rentalAvailabilityHold.updateMany');
  const bookingCreateIndex = writer.indexOf('rentalBooking.create');
  assert.ok(consumeIndex >= 0 && bookingCreateIndex > consumeIndex, 'confirmation must consume the hold before creating the booking in one transaction');

  assert.match(integration, /consumed rental hold must be retained by a rental booking/i);
  assert.match(integration, /db\.\$transaction\(async \(transaction\) =>/);
  assert.match(integration, /pricing snapshot must match retained source hold evidence/i);
});

test('documentation limits the change to confirmation evidence integrity', () => {
  assert.match(docs, /rental availability hold becomes retained confirmation evidence/i);
  assert.match(docs, /cannot commit in `CONSUMED` state unless the same tenant transaction/i);
  assert.match(docs, /deferred PostgreSQL constraint trigger/i);
  assert.match(docs, /does not add deposits, online checkout, late fees, delivery, inspection, maintenance, or customer self-service/i);
  assert.match(docs, /GitHub Actions are not used/i);
});
