import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const paths = {
  rootSchema: new URL('../prisma/schema.prisma', import.meta.url),
  schema: new URL('../prisma/rental-inventory.prisma', import.meta.url),
  rescheduleSchema: new URL('../prisma/rental-booking-reschedule.prisma', import.meta.url),
  migration: new URL('../prisma/migrations/20260915123000_rental_booking_foundation/migration.sql', import.meta.url),
  customerIntegrityMigration: new URL('../prisma/migrations/20260915131500_rental_booking_customer_integrity/migration.sql', import.meta.url),
  rescheduleMigration: new URL('../prisma/migrations/20260915173000_rental_booking_reschedule_lifecycle/migration.sql', import.meta.url),
  writer: new URL('../src/server/bookings/rental-booking-service.ts', import.meta.url),
  availability: new URL('../src/server/inventory/rental-availability-service.ts', import.meta.url),
  authority: new URL('../src/server/bookings/rental-booking-authority-service.ts', import.meta.url),
  holdService: new URL('../src/server/inventory/rental-hold-service.ts', import.meta.url),
  customerService: new URL('../src/server/customers/customer-service.ts', import.meta.url),
  docs: new URL('../docs/rental-booking-foundation.md', import.meta.url),
  inventoryDocs: new URL('../docs/rental-inventory.md', import.meta.url),
  customerDocs: new URL('../docs/customer-data-lifecycle.md', import.meta.url),
};

const [
  rootSchema,
  schema,
  rescheduleSchema,
  migration,
  customerIntegrityMigration,
  rescheduleMigration,
  writer,
  availability,
  authority,
  holdService,
  customerService,
  docs,
  inventoryDocs,
  customerDocs,
] = await Promise.all(Object.values(paths).map((path) => readFile(path, 'utf8')));

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
  assert.match(schema, /reschedules\s+RentalBookingReschedule\[\]/);
  assert.match(rescheduleSchema, /booking\s+RentalBooking\s+@relation\(fields: \[bookingId, organizationId\], references: \[id, organizationId\]/);
  assert.match(rescheduleSchema, /map: "rental_booking_reschedules_booking_fkey"/);
  assert.match(rescheduleMigration, /ADD CONSTRAINT "rental_booking_reschedules_booking_fkey"/);
});

void test('rental booking customer ownership is represented in Prisma and protected by a composite database foreign key', () => {
  assert.match(rootSchema, /rentalBookings\s+RentalBooking\[\]/);
  assert.match(
    schema,
    /customer\s+Customer\s+@relation\(fields: \[customerId, organizationId\], references: \[id, organizationId\], onDelete: Restrict, onUpdate: Cascade, map: "rental_bookings_customer_fkey"\)/,
  );
  assert.match(customerIntegrityMigration, /ADD CONSTRAINT "rental_bookings_customer_fkey"/);
  assert.match(customerIntegrityMigration, /FOREIGN KEY \("customerId", "organizationId"\)/);
  assert.match(customerIntegrityMigration, /REFERENCES "customers"\("id", "organizationId"\)/);
  assert.match(customerIntegrityMigration, /ON DELETE RESTRICT/);
  assert.match(customerIntegrityMigration, /ON UPDATE CASCADE/);
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
  assert.match(rescheduleMigration, /sf_guard_rental_booking_reschedule_insert/);
  assert.match(rescheduleMigration, /sf_guard_rental_booking_reschedule_append_only/);
  assert.match(rescheduleMigration, /rental_booking_reschedules_require_allocation_guard/);
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

void test('rental booking references participate in the fail-closed customer de-identification boundary', () => {
  assert.match(customerService, /db\.rentalBooking\.count\(\{/);
  assert.match(customerService, /transaction\.rentalBooking\.count\(\{/);
  assert.match(customerService, /const bookingReferenceCount = hospitalityBookingReferenceCount \+ rentalBookingReferenceCount/);
  assert.match(customerService, /where: \{ organizationId: input\.organizationId, customerId: current\.id \}/);
  assert.match(docs, /Customer lifecycle integration/);
  assert.match(docs, /hospitality and rental booking references/);
  assert.match(customerDocs, /zero hospitality and rental booking references/i);
});

void test('documentation reflects durable rental booking infrastructure without presenting unfinished commercial workflows as real', () => {
  assert.match(inventoryDocs, /durable rental booking writer/i);
  assert.match(inventoryDocs, /overlapping non-cancelled rental booking allocations/i);
  assert.match(inventoryDocs, /same-unit, price-neutral date rescheduling/i);
  assert.match(inventoryDocs, /unit substitution and price-changing rental amendments/i);
  assert.match(docs, /staff-only conversion review\/confirmation, booking list\/detail, same-unit price-neutral date rescheduling/i);
  assert.match(docs, /damage-case assessment records operational repair-estimate evidence only/i);
  assert.match(docs, /does not imply payment or fulfillment/i);
  assert.match(docs, /Full database validation must run through `npm run test:database`/);
  assert.match(docs, /No GitHub Actions are required or used/);
});
