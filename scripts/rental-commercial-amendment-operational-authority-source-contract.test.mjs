import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'prisma/migrations/20260920082500-rental-commercial-amendment-operational-authority/migration.sql',
  'utf8',
);
const postLockExpiryMigration = readFileSync(
  'prisma/migrations/20260920092500-rental-commercial-amendment-post-lock-expiry-authority/migration.sql',
  'utf8',
);
const prepareService = readFileSync('src/server/bookings/rental-booking-commercial-amendment-service.ts', 'utf8');
const settlementService = readFileSync('src/server/bookings/rental-booking-commercial-amendment-settlement-service.ts', 'utf8');
const prepareRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/commercial-amendments/route.ts', 'utf8');
const docs = readFileSync('docs/rental-commercial-amendment-operational-authority.md', 'utf8');

test('prepared commercial amendment database authority is tenant and assignment scoped', () => {
  assert.match(migration, /sf_guard_rental_commercial_amendment_prepared_authority/);
  assert.match(migration, /NEW\."status" <> 'PREPARED'/);
  assert.match(migration, /NEW\."expiresAt" <= clock_timestamp\(\)/);
  assert.match(migration, /sf:rental-booking:[\s\S]*NEW\."organizationId"[\s\S]*NEW\."bookingId"/);
  assert.match(migration, /JOIN "rental_booking_allocations" allocation/);
  assert.match(migration, /booking\."organizationId" = NEW\."organizationId"/);
  assert.match(migration, /NEW\."bookingVersion" IS DISTINCT FROM booking_updated_at/);
  assert.match(migration, /NEW\."unitId" IS DISTINCT FROM allocation_unit_id/);
  assert.match(migration, /NEW\."sourceStartsOn" IS DISTINCT FROM allocation_starts_on/);
  assert.match(migration, /NEW\."sourceEndsOn" IS DISTINCT FROM allocation_ends_on/);
  assert.match(migration, /unit\."organizationId" = NEW\."organizationId"/);
  assert.match(migration, /unit\."status" = 'ACTIVE'/);
  assert.match(migration, /unit_type\."status" = 'ACTIVE'/);
  assert.match(migration, /location\."status" = 'ACTIVE'/);
});

test('prepared authority repeats custody and physical readiness at the database boundary', () => {
  assert.match(migration, /event\."kind" = 'RETURNED'/);
  assert.match(migration, /NEW\."mode" = 'PRE_PICKUP_RESCHEDULE'/);
  assert.match(migration, /event\."kind" = 'PICKED_UP'/);
  assert.match(migration, /event\."id" = NEW\."pickupEventId"/);
  assert.match(migration, /event\."unitId" = NEW\."unitId"/);
  assert.match(
    migration,
    /sf_assert_rental_unit_operationally_available\([\s\S]*NEW\."organizationId"[\s\S]*NEW\."unitId"/,
  );
  assert.match(migration, /BEFORE INSERT ON "rental_booking_commercial_amendments"/);
});

test('final apply rechecks live expiry and readiness at the durable update boundary', () => {
  assert.match(migration, /sf_guard_rental_commercial_amendment_apply_readiness/);
  assert.match(migration, /OLD\."status" = 'PREPARED' AND NEW\."status" = 'APPLIED'/);
  assert.match(migration, /clock_timestamp\(\) >= OLD\."expiresAt"/);
  assert.match(
    migration,
    /sf_assert_rental_unit_operationally_available\([\s\S]*NEW\."organizationId"[\s\S]*NEW\."unitId"/,
  );
  assert.match(migration, /BEFORE UPDATE OF "status" ON "rental_booking_commercial_amendments"/);
});

test('new adjustment money has a direct-SQL readiness backstop while compensation stays available', () => {
  assert.match(migration, /sf_guard_rental_commercial_amendment_adjustment_readiness/);
  assert.match(migration, /IF NEW\."purpose" <> 'ADJUSTMENT' THEN[\s\S]*RETURN NEW/);
  assert.match(migration, /amendment\."status" = 'PREPARED'/);
  assert.match(
    migration,
    /sf_assert_rental_unit_operationally_available\([\s\S]*NEW\."organizationId"[\s\S]*amendment_unit_id/,
  );
  assert.match(
    migration,
    /settlement_transactions_authority_readiness_guard[\s\S]*BEFORE INSERT ON "rental_booking_commercial_amendment_settlement_transactions"/,
  );
  assert.match(docs, /Compensation is deliberately not blocked/i);
});

test('fresh commercial amendment expiry is rechecked after physical-unit lock waits', () => {
  for (const functionName of [
    'sf_guard_rental_commercial_amendment_prepared_authority',
    'sf_guard_rental_commercial_amendment_adjustment_readiness',
    'sf_guard_rental_commercial_amendment_apply_readiness',
  ]) {
    assert.match(postLockExpiryMigration, new RegExp(`CREATE OR REPLACE FUNCTION ${functionName}\\(\\)`));
  }

  assert.match(
    postLockExpiryMigration,
    /sf_assert_rental_unit_operationally_available\([\s\S]*NEW\."unitId"[\s\S]*NEW\."expiresAt" <= clock_timestamp\(\)/,
  );
  assert.match(postLockExpiryMigration, /SELECT amendment\."unitId", amendment\."expiresAt"/);
  assert.match(
    postLockExpiryMigration,
    /sf_assert_rental_unit_operationally_available\([\s\S]*amendment_unit_id[\s\S]*clock_timestamp\(\) >= amendment_expires_at/,
  );
  assert.match(
    postLockExpiryMigration,
    /sf_assert_rental_unit_operationally_available\([\s\S]*NEW\."unitId"[\s\S]*clock_timestamp\(\) >= OLD\."expiresAt"/,
  );
  assert.match(postLockExpiryMigration, /IF NEW\."purpose" <> 'ADJUSTMENT' THEN[\s\S]*RETURN NEW/);
  assert.match(docs, /after the physical-unit lock/i);
  assert.match(docs, /lock wait itself can cross expiry/i);
});

test('supported application flow already serializes and maps database readiness conflicts', () => {
  assert.match(prepareService, /rentalBookingLockKey/);
  assert.match(prepareService, /rentalUnitLockKey/);
  assert.match(prepareService, /rentalBookingCommercialAmendment\.create/);
  assert.match(settlementService, /findRentalUnitOperationalReadinessBlocker/);
  assert.match(settlementService, /rentalUnitLockKey/);
  assert.match(settlementService, /const \[lockedClock\][\s\S]*SELECT clock_timestamp\(\) AS "now"/);
  assert.match(settlementService, /amendment\.expiresAt <= lockedClock\.now/);
  assert.match(prepareRoute, /RentalBookingCommercialAmendmentConflictError/);
  assert.match(prepareRoute, /return 'conflict'/);
  assert.match(docs, /PostgreSQL remains the final concurrency and direct-write authority/);
});
