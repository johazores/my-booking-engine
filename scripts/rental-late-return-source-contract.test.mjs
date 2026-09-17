import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('prisma/rental-late-return.prisma');
const inventorySchema = read('prisma/rental-inventory.prisma');
const fulfillmentSchema = read('prisma/rental-booking-fulfillment.prisma');
const migration = read('prisma/migrations/20260917072000_rental_late_return_assessment/migration.sql');
const service = read('src/server/bookings/rental-late-return-service.ts');
const domain = read('src/server/bookings/rental-late-return-domain.ts');
const panel = read('src/components/rental-late-return-assessment-panel.tsx');
const returnPanel = read('src/components/rental-return-inspection-panel.tsx');
const route = read('app/api/inventory/rentals/bookings/[booking-id]/late-return-assessment/route.ts');
const docs = read('docs/rental-late-return-assessment.md');

test('late-return persistence is tenant-owned, source-linked, append-only, and database-authored', () => {
  assert.match(schema, /model RentalLateReturnAssessment/);
  assert.match(schema, /booking\s+RentalBooking\s+@relation\(fields: \[bookingId, organizationId\]/);
  assert.match(schema, /returnEvent\s+RentalBookingFulfillmentEvent\s+@relation\("RentalLateReturnAssessmentReturnEvent"/);
  assert.match(schema, /@@unique\(\[organizationId, bookingId\]/);
  assert.match(inventorySchema, /lateReturnAssessment\s+RentalLateReturnAssessment\?/);
  assert.match(fulfillmentSchema, /lateReturnAssessment\s+RentalLateReturnAssessment\?\s+@relation\("RentalLateReturnAssessmentReturnEvent"\)/);
  assert.match(migration, /rental_late_return_assessments_booking_fkey/);
  assert.match(migration, /rental_late_return_assessments_return_event_fkey/);
  assert.match(migration, /rental late-return assessments are append-only/);
  assert.match(migration, /clock_timestamp\(\)/);
  assert.match(migration, /'rental-late-return-assessment:' \|\| NEW\."bookingId"::text/);
});

test('PostgreSQL independently derives late timing from retained tenant custody and location timezone', () => {
  for (const evidence of [
    'booking."status" = \'CONFIRMED\'',
    'event."kind" = \'PICKED_UP\'',
    "return_kind <> 'RETURNED'",
    'return_booking_id <> NEW."bookingId"',
    'return_unit_id <> NEW."unitId"',
    'return_occurred_at AT TIME ZONE booking_timezone',
    'actual_late_days',
    'NEW."committedEndsOn" <> return_ends_on',
    'NEW."currency" <> booking_currency',
  ]) assert.ok(migration.includes(evidence), evidence);
  assert.match(migration, /"graceDays" BETWEEN 0 AND 30/);
  assert.match(migration, /"chargeableDays" = GREATEST\(0, "lateDays" - "graceDays"\)/);
});

test('service repeats permissions, tenant scope, shared booking serialization, idempotency, and audit', () => {
  for (const evidence of [
    "permission: 'booking:read'",
    "permission: 'payment:read'",
    "permission: 'booking:manage'",
    "permission: 'payment:manage'",
    'organizationId: input.organizationId',
    'rentalBookingLockKey(input.organizationId, input.bookingId)',
    'rental-late-return-assessment:',
    'classifyRentalBookingWriteError',
    "isolationLevel: 'Serializable'",
    "action: 'booking.rental.late-return-assessed'",
  ]) assert.ok(service.includes(evidence), evidence);
  assert.match(domain, /rentalLocalDateKey/);
  assert.match(domain, /lateDays === 0/);
  assert.match(domain, /chargeableDays === 0/);
});

test('staff UI is connected after return and route uses the safe mutation form boundary', () => {
  assert.match(returnPanel, /RentalLateReturnAssessmentPanel/);
  assert.match(panel, /Record late-return assessment/);
  assert.match(panel, /does not itself move money/);
  assert.match(panel, /booking:manage/);
  assert.match(panel, /payment:manage/);
  assert.match(route, /prepareInventoryMutationRequest/);
  assert.match(route, /readInventoryFormData/);
  assert.match(route, /formField\(formData, 'graceDays'\)/);
  assert.match(route, /formField\(formData, 'confirmation'\) !== 'ACKNOWLEDGED'/);
  assert.match(panel, /value="ACKNOWLEDGED" required/);
  assert.match(route, /assessRentalLateReturn/);
});

test('documentation keeps assessment authority distinct from settlement and extensions', () => {
  assert.match(docs, /not an automatic fee engine/i);
  assert.match(docs, /assessment itself never moves money/i);
  assert.match(docs, /separate full-value manual\/offline late-return settlement workflow/i);
  assert.match(docs, /Rental extensions also remain separate/i);
});
