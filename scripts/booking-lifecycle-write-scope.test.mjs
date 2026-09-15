import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const cancellationSource = fs.readFileSync(
  path.join(root, 'src/server/bookings/hospitality-booking-cancellation-service.ts'),
  'utf8',
);
const rescheduleSource = fs.readFileSync(
  path.join(root, 'src/server/bookings/hospitality-booking-reschedule-service.ts'),
  'utf8',
);
const paymentSource = fs.readFileSync(
  path.join(root, 'src/server/payments/payment-service.ts'),
  'utf8',
);
const document = fs.readFileSync(
  path.join(root, 'docs/booking-lifecycle-write-scope.md'),
  'utf8',
);

function mutationWhereBlocks(text, model) {
  const pattern = new RegExp(`${model}\\.update\\(\\{\\s*where:\\s*\\{([\\s\\S]*?)\\n\\s*\\},\\s*data:`, 'g');
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function assertFields(block, fields, label) {
  for (const field of fields) {
    assert.match(block, new RegExp(`\\b${field}\\b`), `${label} must retain ${field}`);
  }
}

test('same-price reschedule retains tenant, lifecycle, booking version, exact commercial state, and allocation identity', () => {
  const bookingBlocks = mutationWhereBlocks(rescheduleSource, 'hospitalityBooking');
  assert.equal(bookingBlocks.length, 1);
  assertFields(bookingBlocks[0], [
    'id',
    'organizationId',
    'status',
    'paymentStatus',
    'updatedAt',
    'propertyId',
    'roomTypeId',
    'ratePlanId',
    'arrivalDate',
    'departureDate',
    'quantity',
    'currency',
    'accommodationSubtotalMinor',
    'taxTotalMinor',
    'feeTotalMinor',
    'addonTotalMinor',
    'totalMinor',
    'pricingFingerprint',
  ], 'reschedule booking mutation');
  assert.match(bookingBlocks[0], /status:\s*'CONFIRMED'/);
  assert.match(bookingBlocks[0], /updatedAt:\s*booking\.updatedAt/);

  assert.match(rescheduleSource, /const allocation = booking\.allocation;/);
  for (const field of ['organizationId', 'bookingId', 'propertyId', 'roomTypeId', 'quantity', 'arrivalDate', 'departureDate']) {
    assert.match(rescheduleSource, new RegExp(`allocation\\.${field}`), `reschedule allocation coherence must compare ${field}`);
  }
  assert.match(rescheduleSource, /Booking allocation no longer matches the confirmed booking snapshot/);

  const allocationBlocks = mutationWhereBlocks(rescheduleSource, 'hospitalityBookingAllocation');
  assert.equal(allocationBlocks.length, 1);
  assertFields(allocationBlocks[0], [
    'organizationId_bookingId',
    'organizationId',
    'bookingId',
    'propertyId',
    'roomTypeId',
    'arrivalDate',
    'departureDate',
    'quantity',
  ], 'reschedule allocation mutation');
});

test('cancellation retains tenant, validated lifecycle/payment state, version, commercial state, and exact money', () => {
  const blocks = mutationWhereBlocks(cancellationSource, 'hospitalityBooking');
  assert.equal(blocks.length, 1);
  assertFields(blocks[0], [
    'id',
    'organizationId',
    'status',
    'paymentStatus',
    'updatedAt',
    'propertyId',
    'roomTypeId',
    'ratePlanId',
    'arrivalDate',
    'departureDate',
    'quantity',
    'currency',
    'accommodationSubtotalMinor',
    'taxTotalMinor',
    'feeTotalMinor',
    'addonTotalMinor',
    'totalMinor',
    'pricingFingerprint',
  ], 'cancellation booking mutation');
  assert.match(blocks[0], /status:\s*booking\.status/);
  assert.match(blocks[0], /paymentStatus:\s*booking\.paymentStatus/);
  assert.match(blocks[0], /updatedAt:\s*booking\.updatedAt/);
});

test('manual payment and refund booking-state writes retain tenant, confirmed lifecycle, prior payment state, and exact money', () => {
  const blocks = mutationWhereBlocks(paymentSource, 'hospitalityBooking');
  assert.equal(blocks.length, 2);
  for (const [index, block] of blocks.entries()) {
    assertFields(block, ['id', 'organizationId', 'status', 'paymentStatus', 'currency', 'totalMinor'], `manual payment booking mutation ${index + 1}`);
    assert.match(block, /status:\s*'CONFIRMED'/);
    assert.match(block, /paymentStatus:\s*booking\.paymentStatus/);
    assert.match(block, /currency:\s*booking\.currency/);
    assert.match(block, /totalMinor:\s*booking\.totalMinor/);
  }
});

test('reviewed production sources no longer contain the historical id-only booking update pattern', () => {
  const historicalPattern = /hospitalityBooking\.update\(\{\s*where:\s*\{\s*id:\s*booking\.id\s*\},/;
  assert.doesNotMatch(cancellationSource, historicalPattern);
  assert.doesNotMatch(rescheduleSource, historicalPattern);
  assert.doesNotMatch(paymentSource, historicalPattern);
});

test('workflow protections and documentation remain explicit', () => {
  assert.match(rescheduleSource, /permission: 'booking:manage'/);
  assert.match(rescheduleSource, /hospitalityBookingMutationLockKey/);
  assert.match(rescheduleSource, /hospitalityAvailabilityAllocationLockKey/);
  assert.match(rescheduleSource, /hospitalityBookingPriceSnapshotMatches\(booking, latestPrice\)/);
  assert.match(rescheduleSource, /BOOKING_RESCHEDULE/);
  assert.match(rescheduleSource, /isolationLevel: 'Serializable'/);

  assert.match(cancellationSource, /permission: 'booking:manage'/);
  assert.match(cancellationSource, /bookingCancellationPaymentBlockReason/);
  assert.match(cancellationSource, /findActiveHospitalityBookingCommercialAmendment/);
  assert.match(cancellationSource, /isolationLevel: 'Serializable'/);

  assert.match(paymentSource, /permission: 'payment:manage'/);
  assert.match(paymentSource, /ManualPaymentProvider/);
  assert.match(paymentSource, /deriveBookingRefundExecutionPlan/);
  assert.match(paymentSource, /isolationLevel: 'Serializable'/);

  assert.match(document, /Same-price reschedule/);
  assert.match(document, /Cancellation/);
  assert.match(document, /Manual payment and refund booking state/);
  assert.match(document, /Similar-issue sweep/);
  assert.match(document, /PostgreSQL/);
  assert.match(document, /GitHub Actions are intentionally not used/);
});
