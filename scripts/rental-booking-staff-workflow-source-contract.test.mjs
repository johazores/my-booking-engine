import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readService = readFileSync('src/server/bookings/rental-booking-read-service.ts', 'utf8');
const holdDetail = readFileSync('app/inventory/rentals/holds/[hold-id]/page.tsx', 'utf8');
const confirmRoute = readFileSync('app/api/inventory/rentals/holds/[hold-id]/confirm/route.ts', 'utf8');
const bookingList = readFileSync('app/inventory/rentals/bookings/page.tsx', 'utf8');
const bookingDetail = readFileSync('app/inventory/rentals/bookings/[booking-id]/page.tsx', 'utf8');
const documentation = readFileSync('docs/rental-booking-staff-workflow.md', 'utf8');
const foundation = readFileSync('docs/rental-booking-foundation.md', 'utf8');
const inventoryDoc = readFileSync('docs/rental-inventory.md', 'utf8');
const integration = readFileSync('src/server/bookings/rental-booking.integration.ts', 'utf8');

test('rental booking read model requires booking read permission and repeats tenant scope', () => {
  assert.match(readService, /permission: 'booking:read'/);
  assert.match(readService, /where: \{ id: input\.bookingId, organizationId: input\.organizationId \}/);
  assert.match(readService, /const where: Prisma\.RentalBookingWhereInput = \{ organizationId: input\.organizationId \}/);
  assert.match(readService, /Math\.min\(pageSize, 100\)/);
  assert.match(readService, /status\?: RentalBookingListStatus/);
  assert.match(integration, /bookingReads\.getRentalBooking/);
  assert.match(integration, /bookingReads\.listRentalBookings/);
  assert.match(integration, /organizationId: otherOrganization\.id/);
  assert.match(integration, /otherTenantList\.total, 0/);
});

test('staff hold review binds a real active customer to server conversion authority before rendering confirmation', () => {
  assert.match(holdDetail, /reviewRentalBookingConversionAuthority/);
  assert.match(holdDetail, /status: 'ACTIVE'/);
  assert.match(holdDetail, /pageSize: 25/);
  assert.match(holdDetail, /canConfirmConversion = canReviewConversion && canManageAvailability/);
  assert.match(holdDetail, /name="authorityFingerprint" value=\{conversionReview\.authorityFingerprint\}/);
  assert.match(holdDetail, /Confirm rental booking/);
});

test('confirmation route derives tenant, actor, and idempotency authority server-side', () => {
  assert.match(confirmRoute, /prepareInventoryMutationRequest\(request, 'booking\.rental\.confirm'\)/);
  assert.match(confirmRoute, /organizationId: organization\.id/);
  assert.match(confirmRoute, /actorUserId: session\.user\.id/);
  assert.match(confirmRoute, /const idempotencyKey = `rental:\$\{params\['hold-id'\]\}:\$\{customerId\}`/);
  assert.doesNotMatch(confirmRoute, /formField\(formData, 'organizationId'\)/);
  assert.doesNotMatch(confirmRoute, /formField\(formData, 'actorUserId'\)/);
  assert.doesNotMatch(confirmRoute, /formField\(formData, 'idempotencyKey'\)/);
});

test('staff booking list and detail are real bounded read surfaces without unsupported commercial actions', () => {
  assert.match(bookingList, /listRentalBookings/);
  assert.match(bookingList, /parseInventoryPageSize/);
  assert.match(bookingList, /Review active holds/);
  assert.match(bookingDetail, /getRentalBooking/);
  assert.match(bookingDetail, /missing its physical-unit allocation/);
  assert.match(bookingDetail, /payment\/deposit collection, pickup, delivery, return, and fulfillment are not implied/);
  for (const unsupportedAction of ['Collect payment', 'Take deposit', 'Cancel rental', 'Complete pickup', 'Complete return']) {
    assert.doesNotMatch(`${bookingList}\n${bookingDetail}`, new RegExp(unsupportedAction, 'i'));
  }
});

test('documentation preserves the production boundary and forbids fake downstream workflow claims', () => {
  assert.match(documentation, /server-derived organization\/actor\/idempotency authority/);
  assert.match(documentation, /caps page size at 100/);
  assert.match(documentation, /does not implement or imply/);
  assert.match(documentation, /payment collection/);
  assert.match(documentation, /booking cancellation, amendment, or rescheduling/);
  assert.match(documentation, /GitHub Actions are not required or used/);
  assert.match(foundation, /Staff booking interaction/);
  assert.match(foundation, /rental-booking-staff-workflow\.md/);
  assert.match(inventoryDoc, /staff conversion interaction/);
  assert.match(inventoryDoc, /rental booking list\/detail pages/);
  assert.doesNotMatch(inventoryDoc, /staff-facing rental booking conversion UI, booking list\/detail UI/);
});
