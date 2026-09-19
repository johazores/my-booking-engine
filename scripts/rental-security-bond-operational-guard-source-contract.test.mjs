import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const guardService = read('src/server/bookings/rental-booking-security-bond-guard-service.ts');
const fulfillmentService = read('src/server/bookings/rental-booking-fulfillment-service.ts');
const cancellationService = read('src/server/bookings/rental-booking-cancellation-service.ts');
const bookingDetail = read('app/inventory/rentals/bookings/[booking-id]/page.tsx');
const bondMigration = read('prisma/migrations/20260917030000_rental_security_bond_foundation/migration.sql');
const docs = read('docs/rental-security-bond-operational-guards.md');

test('booking operational guard reconciles tenant-owned bond evidence without exposing payment details', () => {
  assert.match(guardService, /permission: 'booking:read'/);
  assert.match(guardService, /organizationId: input\.organizationId/);
  assert.match(guardService, /bookingId: input\.bookingId/);
  assert.match(guardService, /rentalSecurityBondRequirement\.findFirst/);
  assert.match(guardService, /rentalSecurityBondTransaction\.findMany/);
  assert.match(guardService, /rentalSecurityBondForfeiture\.findFirst/);
  assert.match(guardService, /buildRentalSecurityBondRequestFingerprint/);
  assert.match(guardService, /deriveRentalSecurityBondSettlement/);
  assert.match(guardService, /blocksPickup: settlement\.state !== 'COLLECTED'/);
  assert.match(guardService, /blocksCancellation: settlement\.state === 'COLLECTED'/);
  assert.doesNotMatch(guardService, /return Object\.freeze\(\{[^}]*providerReference/s);
});

test('fresh pickup checks active bond authority under the booking transaction before custody evidence', () => {
  const guardRead = fulfillmentService.indexOf('const securityBondGuard = await readRentalBookingSecurityBondGuardInTransaction');
  const eventCreate = fulfillmentService.indexOf('transaction.rentalBookingFulfillmentEvent.create');
  assert.ok(guardRead >= 0, 'security-bond guard lookup missing from fulfillment writer');
  assert.ok(eventCreate > guardRead, 'security-bond pickup guard must run before new custody evidence');
  assert.match(fulfillmentService, /if \(input\.kind === 'PICKED_UP'\) \{[\s\S]*securityBondGuard\.blocksPickup/);
  assert.match(fulfillmentService, /Rental pickup requires the retained security bond to be actively collected/);
});

test('cancellation checks held bond money before terminal booking update', () => {
  const guardRead = cancellationService.indexOf('const securityBondGuard = await readRentalBookingSecurityBondGuardInTransaction');
  const cancellationUpdate = cancellationService.indexOf('transaction.rentalBooking.updateMany');
  assert.ok(guardRead >= 0, 'security-bond guard lookup missing from cancellation writer');
  assert.ok(cancellationUpdate > guardRead, 'held-bond cancellation guard must run before terminal booking update');
  assert.match(cancellationService, /securityBondGuard\.blocksCancellation/);
  assert.match(cancellationService, /Release the collected rental security bond before cancelling this booking/);
});

test('PostgreSQL remains the independent final backstop for pickup and cancellation', () => {
  assert.match(bondMigration, /rental_fulfillment_security_bond_pickup_guard/);
  assert.match(bondMigration, /rental pickup requires the retained security bond to be actively collected/);
  assert.match(bondMigration, /rental_booking_security_bond_cancellation_guard/);
  assert.match(bondMigration, /release the collected rental security bond before cancelling this booking/);
});

test('staff booking detail removes dead pickup and cancellation actions for unresolved bond state', () => {
  assert.match(bookingDetail, /readRentalBookingSecurityBondGuard/);
  assert.match(bookingDetail, /&& !securityBondGuard\.blocksPickup/);
  assert.match(bookingDetail, /Pickup requires an actively collected security bond/);
  assert.match(bookingDetail, /Review security bond/);
  assert.match(bookingDetail, /securityBondGuard\.blocksCancellation \?/);
  assert.match(bookingDetail, /Cancellation is paused while security-bond money is held/);
  assert.match(bookingDetail, /<RentalBookingCancelAction/);
});

test('documentation keeps application UX and database authority boundaries explicit', () => {
  assert.match(docs, /booking-read-authorized operational projection/);
  assert.match(docs, /writer checks run under the existing tenant\/booking advisory lock/);
  assert.match(docs, /PostgreSQL remains the independent final authority/);
  assert.match(docs, /does not move, collect, release, or forfeit money/);
});
