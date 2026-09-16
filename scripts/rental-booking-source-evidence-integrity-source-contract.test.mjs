import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const writer = read('src/server/bookings/rental-booking-service.ts');
const migration = read('prisma/migrations/20260916143000_rental_booking_source_evidence_integrity/migration.sql');
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

test('documentation limits the change to confirmation evidence integrity', () => {
  assert.match(docs, /rental availability hold becomes retained confirmation evidence/i);
  assert.match(docs, /does not add deposits, online checkout, late fees, delivery, inspection, maintenance, or customer self-service/i);
  assert.match(docs, /GitHub Actions are not used/i);
});
