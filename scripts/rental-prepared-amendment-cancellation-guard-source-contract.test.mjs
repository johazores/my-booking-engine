import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const effectiveSettlementService = readFileSync(
  'src/server/bookings/rental-booking-effective-settlement-service.ts',
  'utf8',
);
const migration = readFileSync(
  'prisma/migrations/20260919133000-rental-cancellation-prepared-amendment-guard/migration.sql',
  'utf8',
);
const cancellationDocs = readFileSync('docs/rental-booking-cancellation.md', 'utf8');
const settlementDocs = readFileSync('docs/rental-booking-effective-settlement.md', 'utf8');

test('effective settlement fails closed while a prepared commercial amendment owns commercial authority', () => {
  assert.match(effectiveSettlementService, /status: 'PREPARED'/);
  assert.match(effectiveSettlementService, /status: 'APPLIED'/);
  assert.match(effectiveSettlementService, /const \[preparedAmendments, appliedAmendments\] = await Promise\.all/);
  assert.match(effectiveSettlementService, /preparedAmendments\.length > 0/);
  assert.match(
    effectiveSettlementService,
    /Rental booking has a prepared commercial amendment\. Finish, compensate, cancel, or expire that workflow before treating settlement as terminal\./,
  );
  assert.match(effectiveSettlementService, /commercialAuthority\.settlement/);
  assert.match(effectiveSettlementService, /settlement: commercialAuthority\.settlement/);
});

test('postgresql independently blocks confirmed-to-cancelled transition while a prepared amendment exists', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION sf_guard_rental_booking_cancellation_prepared_amendment/);
  assert.match(migration, /sf:rental-booking:/);
  assert.match(migration, /OLD\."organizationId"/);
  assert.match(migration, /OLD\."id"/);
  assert.match(migration, /OLD\."status" = 'CONFIRMED'/);
  assert.match(migration, /NEW\."status" = 'CANCELLED'/);
  assert.match(migration, /"rental_booking_commercial_amendments" amendment/);
  assert.match(migration, /amendment\."organizationId" = OLD\."organizationId"/);
  assert.match(migration, /amendment\."bookingId" = OLD\."id"/);
  assert.match(migration, /amendment\."status" = 'PREPARED'/);
  assert.match(migration, /ERRCODE = '23514'/);
  assert.match(migration, /BEFORE UPDATE OF "status", "cancelledAt"/);
});

test('documentation records prepared-amendment ownership as a cancellation and settlement blocker', () => {
  assert.match(cancellationDocs, /prepared commercial amendment/i);
  assert.match(cancellationDocs, /finish, compensate, cancel, or expire/i);
  assert.match(settlementDocs, /prepared commercial amendment/i);
  assert.match(settlementDocs, /not terminal settlement authority/i);
});
