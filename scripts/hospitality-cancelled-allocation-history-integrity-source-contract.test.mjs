import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const migration = read('prisma/migrations/20260921225000-hospitality-cancelled-allocation-history-integrity/migration.sql');
const cancellationService = read('src/server/bookings/hospitality-booking-cancellation-service.ts');
const integration = read('src/server/bookings/hospitality-cancelled-allocation-history-integrity.integration.ts');
const integrityDocs = read('docs/hospitality-cancelled-allocation-history-integrity.md');
const sourceEvidenceDocs = read('docs/hospitality-booking-source-evidence-integrity.md');
const availabilityDocs = read('docs/availability.md');
const databaseRunner = read('scripts/run-database-tests.mjs');

test('cancellation requires a tenant-owned allocation matching current booking inventory state', () => {
  assert.match(cancellationService, /hospitalityBookingAllocation\.findFirst\(\{/);
  assert.match(cancellationService, /organizationId: input\.organizationId/);
  assert.match(cancellationService, /bookingId: booking\.id/);
  assert.match(cancellationService, /propertyId: booking\.propertyId/);
  assert.match(cancellationService, /roomTypeId: booking\.roomTypeId/);
  assert.match(cancellationService, /arrivalDate: booking\.arrivalDate/);
  assert.match(cancellationService, /departureDate: booking\.departureDate/);
  assert.match(cancellationService, /quantity: booking\.quantity/);
  assert.match(cancellationService, /requires retained allocation evidence that matches the current commercial inventory state/i);
  assert.ok(
    cancellationService.indexOf('if (!retainedAllocation)') < cancellationService.indexOf("if (booking.status === 'CANCELLED')"),
    'cancelled replay must not bypass retained-allocation integrity',
  );
});

test('PostgreSQL freezes final allocation inventory fields after cancellation', () => {
  assert.match(migration, /sf_guard_cancelled_hospitality_booking_allocation_history/);
  assert.match(migration, /booking\."organizationId" = OLD\."organizationId"/);
  assert.match(migration, /booking\."id" = OLD\."bookingId"/);
  assert.match(migration, /booking\."status" = 'CANCELLED'/);
  assert.match(migration, /NEW\."propertyId" IS DISTINCT FROM OLD\."propertyId"/);
  assert.match(migration, /NEW\."roomTypeId" IS DISTINCT FROM OLD\."roomTypeId"/);
  assert.match(migration, /NEW\."arrivalDate" IS DISTINCT FROM OLD\."arrivalDate"/);
  assert.match(migration, /NEW\."departureDate" IS DISTINCT FROM OLD\."departureDate"/);
  assert.match(migration, /NEW\."quantity" IS DISTINCT FROM OLD\."quantity"/);
  assert.match(migration, /cancelled hospitality booking allocation history is immutable/);
  assert.match(migration, /BEFORE UPDATE OF "propertyId", "roomTypeId", "arrivalDate", "departureDate", "quantity"/);
  assert.match(migration, /ON "hospitality_booking_allocations"/);
});

test('guarded database scenario covers corrupt pre-cancel state and terminal rewrite rejection', () => {
  assert.match(integration, /hospitalityBookingAllocation\.update\(\{/);
  assert.match(integration, /data: \{ quantity: 2 \}/);
  assert.match(integration, /cancelHospitalityBooking\(\{/);
  assert.match(integration, /requires retained allocation evidence that matches the current commercial inventory state/i);
  assert.match(integration, /assert\.equal\(cancelled\.status, 'CANCELLED'\)/);
  assert.match(integration, /cancelled hospitality booking allocation history is immutable/i);
  assert.match(integration, /data: \{ departureDate: new Date\(/);
  assert.match(databaseRunner, /src\/server\/bookings\/hospitality-cancelled-allocation-history-integrity\.integration\.ts/);
});

test('documentation keeps live availability release separate from retained terminal evidence', () => {
  assert.match(integrityDocs, /releases sellable inventory because availability ignores allocations owned by `CANCELLED` bookings/i);
  assert.match(integrityDocs, /does not change allocation deletion\/retention semantics/i);
  assert.match(sourceEvidenceDocs, /cancellation is a retained lifecycle transition/i);
  assert.match(sourceEvidenceDocs, /terminal guard only freezes the final allocation inventory snapshot once the booking is cancelled/i);
  assert.match(availabilityDocs, /cancellation is a retained `CONFIRMED -> CANCELLED` lifecycle transition/i);
  assert.match(availabilityDocs, /capacity is released exactly through booking lifecycle state rather than by destroying historical inventory evidence/i);
  assert.doesNotMatch(availabilityDocs, /Cancelling a booking does not exist yet/i);
  assert.match(integrityDocs, /GitHub Actions are intentionally not used/i);
});
