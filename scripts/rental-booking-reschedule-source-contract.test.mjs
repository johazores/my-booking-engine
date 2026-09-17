import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('prisma/rental-booking-reschedule.prisma', 'utf8');
const migration = readFileSync('prisma/migrations/20260915173000_rental_booking_reschedule_lifecycle/migration.sql', 'utf8');
const substitutionMigration = readFileSync('prisma/migrations/20260915232000_rental_booking_unit_substitution_lifecycle/migration.sql', 'utf8');
const custodyExtensionMigration = readFileSync('prisma/migrations/20260917102000_rental_booking_custody_extension/migration.sql', 'utf8');
const domain = readFileSync('src/server/bookings/rental-booking-reschedule-domain.ts', 'utf8');
const review = readFileSync('src/server/bookings/rental-booking-reschedule-authority-service.ts', 'utf8');
const writer = readFileSync('src/server/bookings/rental-booking-reschedule-service.ts', 'utf8');
const cancellation = readFileSync('src/server/bookings/rental-booking-cancellation-service.ts', 'utf8');
const readService = readFileSync('src/server/bookings/rental-booking-read-service.ts', 'utf8');
const route = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/reschedule/route.ts', 'utf8');
const page = readFileSync('app/inventory/rentals/bookings/[booking-id]/reschedule/page.tsx', 'utf8');
const detail = readFileSync('app/inventory/rentals/bookings/[booking-id]/page.tsx', 'utf8');
const custodyExtensionPanel = readFileSync('src/components/rental-custody-extension-panel.tsx', 'utf8');
const returnInspectionPanel = readFileSync('src/components/rental-return-inspection-panel.tsx', 'utf8');
const list = readFileSync('app/inventory/rentals/bookings/page.tsx', 'utf8');
const docs = readFileSync('docs/rental-booking-reschedule-lifecycle.md', 'utf8');

test('reschedule evidence is append-only and database allocation authority follows latest dates and effective unit', () => {
  for (const token of [
    'model RentalBookingReschedule',
    '@@unique([organizationId, idempotencyKey]',
    '@@index([organizationId, bookingId, appliedAt]',
  ]) assert.ok(schema.includes(token), `missing reschedule schema token: ${token}`);

  for (const token of [
    'rental_booking_reschedules_booking_fkey',
    'sf_guard_rental_booking_reschedule_insert',
    'sf_guard_rental_booking_reschedule_append_only',
    'sf_guard_rental_booking_allocation',
    'latest_reschedule."targetStartsOn"',
    'latest_reschedule."targetEndsOn"',
    'rental_booking_reschedules_require_allocation_guard',
    'DEFERRABLE INITIALLY DEFERRED',
  ]) assert.ok(migration.includes(token), `missing reschedule migration token: ${token}`);

  assert.match(migration, /BEFORE UPDATE OR DELETE ON "rental_booking_reschedules"/);
  assert.match(migration, /booking\."status" <> 'CONFIRMED'/);
  assert.match(migration, /allocation\."startsOn" = NEW\."targetStartsOn"/);
  assert.match(migration, /allocation\."endsOn" = NEW\."targetEndsOn"/);
  assert.match(substitutionMigration, /sf_rental_booking_effective_unit_id/);
  assert.match(substitutionMigration, /expected_unit_id := sf_rental_booking_effective_unit_id/);
  assert.match(substitutionMigration, /allocation\."unitId" = expected_unit_id/);
});

test('review and apply use tenant permissions, effective-unit locks, fresh inventory, pricing, custody, and stale-authority protection', () => {
  for (const token of [
    "permission: 'booking:manage'",
    "permission: 'availability:read'",
    "permission: 'inventory:read'",
    "permission: 'pricing:read'",
    'organizationId: input.organizationId',
    "status: 'CONFIRMED'",
    'cancelledAt: null',
    'fulfillmentEvents',
    'CUSTODY_EXTENSION',
    'rentalBookingReschedule.findFirst',
    'rentalBookingUnitSubstitution.findFirst',
    'effectiveUnitId',
    'sourceStartsOn',
    'sourceEndsOn',
    'sourcePricingFingerprint',
    'pickupEventId',
  ]) assert.ok(review.includes(token), `missing review token: ${token}`);

  for (const token of [
    "permission: 'booking:manage'",
    "permission: 'availability:read'",
    "permission: 'availability:manage'",
    "permission: 'inventory:read'",
    "permission: 'pricing:read'",
    'rentalBookingLockKey(input.organizationId, input.bookingId)',
    'rentalBookingUnitSubstitution.findFirst',
    'effectiveUnitId',
    'rentalUnitLockKey(input.organizationId, effectiveUnitId)',
    'SELECT clock_timestamp() AS "now"',
    "isolationLevel: 'Serializable'",
    'bookingId: { not: booking.id }',
    'expiresAt: { gt: databaseClock.now }',
    'findOverdueRentalCustodyUnitIds',
    'buildRentalPricingEvidence({',
    'buildRentalBookingRescheduleAuthorityFingerprint({',
    'requested.authorityFingerprint !== expectedAuthorityFingerprint',
    'rentalBookingReschedule.create({',
    'rentalBookingAllocation.updateMany({',
    'rentalBooking.updateMany({',
    "'booking.rental.extended'",
    "'booking.rental.rescheduled'",
  ]) assert.ok(writer.includes(token), `missing writer token: ${token}`);

  assert.match(domain, /version: 3/);
  assert.match(domain, /mode: input\.mode/);
  assert.match(domain, /pickupEventId: input\.pickupEventId/);
  assert.match(domain, /sourceStartsOn:/);
  assert.match(domain, /sourceEndsOn:/);
  assert.match(domain, /bookingUpdatedAt:/);
  assert.match(domain, /rental-reschedule:/);
});

test('picked-up booking changes are constrained to same-start later-end extensions at application and database boundaries', () => {
  assert.match(domain, /isRentalBookingCustodyExtensionTarget/);
  assert.match(domain, /targetStartsOn\.getTime\(\) === input\.sourceStartsOn\.getTime\(\)/);
  assert.match(domain, /targetEndsOn\.getTime\(\) > input\.sourceEndsOn\.getTime\(\)/);
  assert.match(review, /CUSTODY_EXTENSION_REQUIRED/);
  assert.match(review, /mode === 'CUSTODY_EXTENSION'/);
  assert.match(writer, /mode === 'CUSTODY_EXTENSION'/);
  assert.match(writer, /Returned rentals cannot be rescheduled or extended/);
  assert.match(custodyExtensionMigration, /sf_guard_rental_booking_reschedule_custody_boundary/);
  assert.match(custodyExtensionMigration, /event\."kind" = 'RETURNED'/);
  assert.match(custodyExtensionMigration, /NEW\."targetStartsOn" <> current_starts_on/);
  assert.match(custodyExtensionMigration, /NEW\."targetEndsOn" <= current_ends_on/);
  assert.match(custodyExtensionMigration, /rental custody extension cannot predate pickup evidence/);
});

test('writer preserves immutable booking evidence while changing only effective allocation dates and booking version', () => {
  assert.match(writer, /unitId: currentUnitId/);
  assert.match(writer, /data: \{ startsOn: requested\.startsOn, endsOn: requested\.endsOn \}/);
  assert.match(writer, /data: \{ updatedAt: databaseClock\.now \}/);
  assert.match(writer, /targetPricingSnapshot: toJsonInput\(targetPricing\.snapshot\)/);
  assert.match(writer, /sourcePricingFingerprint/);
  assert.match(writer, /targetPricingFingerprint: targetPricing\.fingerprint/);
  assert.match(docs, /original `RentalBooking` ownership[\s\S]*remain immutable/i);
});

test('staff route derives tenant actor idempotency and safe form authority server-side and exposes supported extension UX', () => {
  assert.match(route, /prepareInventoryMutationRequest\(request, 'booking\.rental\.reschedule'\)/);
  assert.match(route, /readInventoryFormData\(request\)/);
  assert.match(route, /organizationId: organization\.id/);
  assert.match(route, /actorUserId: session\.user\.id/);
  assert.match(route, /buildRentalBookingRescheduleIdempotencyKey/);
  assert.doesNotMatch(route, /formField\(formData, 'organizationId'\)/);
  assert.doesNotMatch(route, /formField\(formData, 'actorUserId'\)/);
  assert.doesNotMatch(route, /formField\(formData, 'idempotencyKey'\)/);
  assert.match(page, /Apply reschedule/);
  assert.match(page, /Apply extension/);
  assert.match(page, /custodyExtension/);
  assert.match(page, /authorityFingerprint/);
  assert.match(page, /canApply = canReview && hasPermission\('availability:manage'\)/);
  assert.match(page, /booking\.allocation\.unit\.name/);
});

test('read and cancellation paths use current effective allocation after reschedules and substitutions', () => {
  assert.match(readService, /rentalBookingReschedule\.findMany/);
  assert.match(readService, /rentalBookingUnitSubstitution\.findMany/);
  assert.match(readService, /organizationId: input\.organizationId/);
  assert.match(detail, /Committed rental period/);
  assert.match(detail, /Original booking-time period/);
  assert.match(detail, /Physical-unit substitution evidence/);
  assert.match(detail, /Reschedule and extension evidence/);
  assert.match(custodyExtensionPanel, /Extend rental/);
  assert.match(custodyExtensionPanel, /\/reschedule/);
  assert.match(returnInspectionPanel, /fulfillmentState === 'PICKED_UP'/);
  assert.match(returnInspectionPanel, /RentalCustodyExtensionPanel/);
  assert.match(list, /booking\.allocation\.startsOn/);
  assert.match(list, /booking\.allocation\.endsOn/);
  assert.match(list, /booking\.allocation\.unit\.name/);
  assert.match(cancellation, /rentalBookingReschedule\.findFirst/);
  assert.match(cancellation, /rentalBookingUnitSubstitution\.findFirst/);
  assert.match(cancellation, /effectiveStartsOn/);
  assert.match(cancellation, /effectiveEndsOn/);
  assert.match(cancellation, /latestUnitSubstitutionId/);
});
