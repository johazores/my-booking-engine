import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const paths = {
  schema: new URL('../prisma/rental-inventory.prisma', import.meta.url),
  migration: new URL('../prisma/migrations/20260915123000_rental_booking_foundation/migration.sql', import.meta.url),
  writer: new URL('../src/server/bookings/rental-booking-service.ts', import.meta.url),
  availability: new URL('../src/server/inventory/rental-availability-service.ts', import.meta.url),
  authority: new URL('../src/server/bookings/rental-booking-authority-service.ts', import.meta.url),
  holdService: new URL('../src/server/inventory/rental-hold-service.ts', import.meta.url),
  docs: new URL('../docs/rental-booking-foundation.md', import.meta.url),
};

const [schema, migration, writer, availability, authority, holdService, docs] = await Promise.all(
  Object.values(paths).map((path) => readFile(path, 'utf8')),
);

void test('rental booking schema persists tenant-owned commercial evidence and one physical allocation', () => {
  for (const token of [
    'model RentalBooking {',
    'organizationId',
    'customerId',
    'customerFirstName',
    'customerLastName',
    'holdId',
    'unitId',
    'unitTypeId',
    'locationId',
    'idempotencyKey',
    'totalMinor',
    'pricingFingerprint',
    'pricingSnapshot',
    'pricingObservedAt',
    'authorityFingerprint',
    '@@unique([organizationId, idempotencyKey]',
    '@@unique([organizationId, holdId]',
    'model RentalBookingAllocation {',
    '@@unique([organizationId, bookingId]',
  ]) {
    assert.ok(schema.includes(token), `missing rental booking schema token: ${token}`);
  }
  assert.ok(schema.includes('bookingAllocations RentalBookingAllocation[]'));
});

void test('database guards serialize unit inventory and protect customer, hold, booking, and allocation integrity', () => {
  for (const token of [
    'sf_guard_rental_booking_insert',
    'rental booking customer ownership or snapshot is invalid',
    'source_hold."status" <> \'CONSUMED\'',
    'sf_guard_rental_booking_immutable_evidence',
    'sf_guard_rental_booking_allocation',
    "'sf:rental-unit:'",
    'booking."status" <> \'CANCELLED\'',
    'rental booking allocation overlaps another active booking',
    'sf_guard_rental_booking_requires_allocation',
    'DEFERRABLE INITIALLY DEFERRED',
    'sf_guard_rental_hold_overlap',
    'rental availability hold overlaps an active booking',
    'sf_guard_rental_block_against_holds',
    'rental unavailable-date block overlaps an active booking',
    'sf_guard_rental_unit_mutation_against_holds',
    'active or future rental bookings must be resolved before changing this rental unit',
  ]) {
    assert.ok(migration.includes(token), `missing rental booking migration guard: ${token}`);
  }
});

void test('confirmation writer revalidates tenant authority under idempotency and unit locks before atomic persistence', () => {
  for (const permission of ['booking:manage', 'availability:manage', 'inventory:read', 'pricing:read', 'customer:read']) {
    assert.ok(writer.includes(`permission: '${permission}'`), `missing permission ${permission}`);
  }
  for (const token of [
    'bookingIdempotencyLockKey',
    'rentalUnitLockKey',
    'SELECT clock_timestamp() AS "now"',
    'organizationId_idempotencyKey',
    'rentalBookingConfirmationPayloadMatches',
    'rentalBookingAllocation.findFirst',
    'buildRentalPricingEvidence',
    'buildRentalBookingConversionAuthorityFingerprint',
    'confirmation.authorityFingerprint !== expectedAuthorityFingerprint',
    'rentalAvailabilityHold.updateMany',
    "status: 'ACTIVE'",
    "status: 'CONSUMED'",
    'consumed.count !== 1',
    'rentalBooking.create',
    'rentalBookingAllocation.create',
    "action: 'booking.rental.confirmed'",
    "isolationLevel: 'Serializable'",
    "code === 'P2002' || code === 'P2034'",
  ]) {
    assert.ok(writer.includes(token), `missing rental booking writer contract: ${token}`);
  }
});

void test('availability, hold creation, and conversion review exclude overlapping non-cancelled booking allocations', () => {
  for (const source of [availability, authority, holdService]) {
    assert.ok(source.includes('rentalBookingAllocation') || source.includes('bookingAllocations'));
    assert.ok(source.includes("status: { not: 'CANCELLED'"));
    assert.ok(source.includes('organizationId: input.organizationId'));
  }
  assert.ok(availability.includes('SELECT clock_timestamp() AS "now"'));
  assert.match(holdService, /already booked for part of the requested date range/i);
});

void test('documentation keeps unimplemented rental commercial capabilities outside the production contract', () => {
  assert.match(docs, /does not expose a new booking page, public route, checkout, provider integration, fake payment flow/i);
  assert.match(docs, /does not imply that money has been collected/i);
  assert.match(docs, /Full database validation must run through `npm run test:database`/);
  assert.match(docs, /No GitHub Actions are required or used/);
});
