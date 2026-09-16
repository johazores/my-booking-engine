import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const migration = read('prisma/migrations/20260916130000_rental_custody_evidence_authority/migration.sql');
const fulfillmentDomain = read('src/server/bookings/rental-booking-fulfillment-domain.ts');
const earlyReturnDomain = read('src/server/bookings/rental-booking-early-return-release-domain.ts');

test('fulfillment evidence keeps application and database idempotency authority aligned', () => {
  assert.match(fulfillmentDomain, /`rental-fulfillment:\$\{bookingId\}:\$\{kind\.toLowerCase\(\)\}`/);
  assert.match(migration, /rental_booking_fulfillment_events_idempotency_authority_check/);
  assert.match(migration, /'rental-fulfillment:' \|\| "bookingId"::text \|\| ':' \|\| lower\("kind"::text\)/);
  assert.match(migration, /sf_guard_rental_booking_fulfillment_evidence_authority/);
});

test('return evidence is tied to the retained pickup assignment and chronology', () => {
  assert.match(migration, /pickup_event\."unitId" <> NEW\."unitId"/);
  assert.match(migration, /pickup_event\."startsOn" <> NEW\."startsOn"/);
  assert.match(migration, /pickup_event\."endsOn" <> NEW\."endsOn"/);
  assert.match(migration, /NEW\."occurredAt" < pickup_event\."occurredAt"/);
});

test('fulfillment event time cannot move ahead of PostgreSQL time authority', () => {
  assert.match(migration, /NEW\."occurredAt" > clock_timestamp\(\)/);
});

test('early-return release keeps deterministic idempotency and PostgreSQL time authority', () => {
  assert.match(earlyReturnDomain, /`rental-early-return-release:\$\{bookingId\}`/);
  assert.match(migration, /rental_booking_early_return_releases_idempotency_authority_check/);
  assert.match(migration, /'rental-early-return-release:' \|\| "bookingId"::text/);
  assert.match(migration, /NEW\."releasedAt" > clock_timestamp\(\)/);
});
