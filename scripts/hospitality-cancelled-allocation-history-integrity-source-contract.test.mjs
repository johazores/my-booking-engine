import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const terminalHistoryMigration = read('prisma/migrations/20260921225000-hospitality-cancelled-allocation-history-integrity/migration.sql');
const allocationRetentionMigration = read('prisma/migrations/20260921232000-hospitality-booking-allocation-retention/migration.sql');
const cancellationService = read('src/server/bookings/hospitality-booking-cancellation-service.ts');
const integration = read('src/server/bookings/hospitality-cancelled-allocation-history-integrity.integration.ts');
const integrityDocs = read('docs/hospitality-cancelled-allocation-history-integrity.md');
const sourceEvidenceDocs = read('docs/hospitality-booking-source-evidence-integrity.md');
const availabilityDocs = read('docs/availability.md');
const databaseRunner = read('scripts/run-database-tests.mjs');
const teardownFixtures = [
  'src/server/bookings/hospitality-booking.integration.ts',
  'src/server/bookings/public-hospitality-confirmation.integration.ts',
  'src/server/bookings/hospitality-booking-reschedule.integration.ts',
  'src/server/bookings/hospitality-booking-version-authority.integration.ts',
  'src/server/bookings/hospitality-booking-guest-modification.integration.ts',
  'src/server/bookings/hospitality-booking-commercial-modification.integration.ts',
  'src/server/bookings/hospitality-cancelled-allocation-history-integrity.integration.ts',
].map((path) => ({ path, source: read(path) }));

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
  assert.match(terminalHistoryMigration, /sf_guard_cancelled_hospitality_booking_allocation_history/);
  assert.match(terminalHistoryMigration, /booking\."organizationId" = OLD\."organizationId"/);
  assert.match(terminalHistoryMigration, /booking\."id" = OLD\."bookingId"/);
  assert.match(terminalHistoryMigration, /booking\."status" = 'CANCELLED'/);
  assert.match(terminalHistoryMigration, /NEW\."propertyId" IS DISTINCT FROM OLD\."propertyId"/);
  assert.match(terminalHistoryMigration, /NEW\."roomTypeId" IS DISTINCT FROM OLD\."roomTypeId"/);
  assert.match(terminalHistoryMigration, /NEW\."arrivalDate" IS DISTINCT FROM OLD\."arrivalDate"/);
  assert.match(terminalHistoryMigration, /NEW\."departureDate" IS DISTINCT FROM OLD\."departureDate"/);
  assert.match(terminalHistoryMigration, /NEW\."quantity" IS DISTINCT FROM OLD\."quantity"/);
  assert.match(terminalHistoryMigration, /cancelled hospitality booking allocation history is immutable/);
  assert.match(terminalHistoryMigration, /BEFORE UPDATE OF "propertyId", "roomTypeId", "arrivalDate", "departureDate", "quantity"/);
  assert.match(terminalHistoryMigration, /ON "hospitality_booking_allocations"/);
});

test('every retained hospitality booking keeps allocation evidence at transaction commit', () => {
  assert.match(allocationRetentionMigration, /existing hospitality booking is missing retained allocation evidence/);
  assert.match(allocationRetentionMigration, /sf_guard_hospitality_booking_allocation_retention/);
  assert.match(allocationRetentionMigration, /booking\."organizationId" = OLD\."organizationId"/);
  assert.match(allocationRetentionMigration, /booking\."id" = OLD\."bookingId"/);
  assert.doesNotMatch(allocationRetentionMigration, /booking\."status"\s*=/);
  assert.match(allocationRetentionMigration, /hospitality booking must retain allocation evidence/);
  assert.match(allocationRetentionMigration, /CREATE CONSTRAINT TRIGGER hospitality_booking_allocations_booking_retention_guard/);
  assert.match(allocationRetentionMigration, /AFTER DELETE ON "hospitality_booking_allocations"/);
  assert.match(allocationRetentionMigration, /DEFERRABLE INITIALLY DEFERRED/);
});

test('guarded database scenario covers corrupt state plus live and cancelled allocation retention', () => {
  assert.match(integration, /hospitalityBookingAllocation\.update\(\{/);
  assert.match(integration, /data: \{ quantity: 2 \}/);
  assert.match(integration, /cancelHospitalityBooking\(\{/);
  assert.match(integration, /requires retained allocation evidence that matches the current commercial inventory state/i);
  assert.match(integration, /assert\.equal\(cancelled\.status, 'CANCELLED'\)/);
  assert.match(integration, /cancelled hospitality booking allocation history is immutable/i);
  assert.match(integration, /hospitalityBookingAllocation\.delete\(\{/);
  assert.match(integration, /hospitality booking must retain allocation evidence/i);
  assert.match(databaseRunner, /src\/server\/bookings\/hospitality-cancelled-allocation-history-integrity\.integration\.ts/);
});

test('database fixtures tear down retained allocations and parent bookings atomically', () => {
  for (const fixture of teardownFixtures) {
    assert.match(fixture.source, /db\.\$transaction\(async \(transaction\) => \{/i, `${fixture.path} must use a teardown transaction`);
    assert.match(fixture.source, /transaction\.hospitalityBookingAllocation\.deleteMany\(\{/i, `${fixture.path} must delete allocations inside the teardown transaction`);
    assert.match(fixture.source, /transaction\.hospitalityBooking\.deleteMany\(\{/i, `${fixture.path} must delete bookings inside the teardown transaction`);
    assert.ok(
      fixture.source.indexOf('transaction.hospitalityBookingAllocation.deleteMany') < fixture.source.indexOf('transaction.hospitalityBooking.deleteMany'),
      `${fixture.path} must delete allocation children before parent bookings`,
    );
  }
});

test('documentation keeps live availability release separate from durable allocation retention', () => {
  assert.match(integrityDocs, /every retained hospitality booking must keep its allocation row/i);
  assert.match(integrityDocs, /deferred PostgreSQL constraint trigger rejects deleting an allocation/i);
  assert.match(integrityDocs, /delete the allocation and its owning booking in the same transaction/i);
  assert.match(sourceEvidenceDocs, /every retained hospitality booking must also retain its allocation row/i);
  assert.match(sourceEvidenceDocs, /prevents direct removal of live booking capacity evidence before cancellation/i);
  assert.match(availabilityDocs, /cancellation is a retained `CONFIRMED -> CANCELLED` lifecycle transition/i);
  assert.match(availabilityDocs, /capacity is released exactly through booking lifecycle state rather than by destroying historical inventory evidence/i);
  assert.doesNotMatch(availabilityDocs, /Cancelling a booking does not exist yet/i);
  assert.match(integrityDocs, /GitHub Actions are intentionally not used/i);
});
