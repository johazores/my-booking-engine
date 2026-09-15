import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const lifecycle = source('src/server/bookings/hospitality-booking-commercial-amendment-service.ts');
const apply = source('src/server/bookings/hospitality-booking-commercial-amendment-apply-service.ts');

function mutationWhereBlocks(text, model) {
  const pattern = new RegExp(`${model}\\.update\\(\\{\\s*where:\\s*\\{([\\s\\S]*?)\\n\\s*\\},\\s*data:`, 'g');
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function assertFields(block, fields, label) {
  for (const field of fields) {
    assert.match(block, new RegExp(`\\b${field}\\b`), `${label} must retain ${field} at the final mutation`);
  }
}

test('commercial amendment expiry and cancellation retain tenant and lifecycle authority', () => {
  const blocks = mutationWhereBlocks(lifecycle, 'hospitalityBookingCommercialAmendment');
  assert.equal(blocks.length, 2);

  assertFields(blocks[0], ['id', 'organizationId', 'bookingId', 'status', 'expiresAt', 'targetHoldId'], 'Expiry mutation');
  assert.match(blocks[0], /status:\s*'PREPARED'/);
  assert.match(blocks[0], /expiresAt:\s*\{\s*lte:\s*input\.now\s*\}/);

  assertFields(blocks[1], [
    'id',
    'organizationId',
    'bookingId',
    'status',
    'bookingVersion',
    'selectionFingerprint',
    'adjustmentFingerprint',
    'paymentProviderCode',
    'direction',
    'currency',
    'beforeTotalMinor',
    'afterTotalMinor',
    'deltaMinor',
    'targetHoldId',
    'expiresAt',
  ], 'Cancellation mutation');
  assert.match(blocks[1], /status:\s*'PREPARED'/);
  assert.doesNotMatch(lifecycle, /hospitalityBookingCommercialAmendment\.update\(\{\s*where:\s*\{\s*id:\s*[^,}\n]+\s*\},/);
  assert.match(lifecycle, /hospitalityCommercialAmendmentHasPaymentActivityRequiringRecovery/);
  assert.match(lifecycle, /releaseHospitalityAvailabilityHoldInTransaction/);
  assert.match(lifecycle, /permission: 'booking:manage'/);
  assert.match(lifecycle, /permission: 'payment:manage'/);
  assert.match(lifecycle, /isolationLevel: 'Serializable'/);
});

test('final amendment apply retains the validated booking snapshot', () => {
  const bookingBlocks = mutationWhereBlocks(apply, 'hospitalityBooking');
  assert.equal(bookingBlocks.length, 1);
  assertFields(bookingBlocks[0], [
    'id',
    'organizationId',
    'status',
    'updatedAt',
    'propertyId',
    'roomTypeId',
    'ratePlanId',
    'quantity',
    'paymentStatus',
    'currency',
    'accommodationSubtotalMinor',
    'taxTotalMinor',
    'feeTotalMinor',
    'addonTotalMinor',
    'totalMinor',
    'pricingFingerprint',
  ], 'Booking apply mutation');
  assert.match(bookingBlocks[0], /status:\s*'CONFIRMED'/);
  assert.match(bookingBlocks[0], /updatedAt:\s*amendment\.bookingVersion/);
  assert.match(bookingBlocks[0], /paymentStatus:\s*'PAID'/);
  assert.doesNotMatch(apply, /hospitalityBooking\.update\(\{\s*where:\s*\{\s*id:\s*[^,}\n]+\s*\},/);
});

test('final amendment apply retains immutable amendment identity and target lifecycle', () => {
  const amendmentBlocks = mutationWhereBlocks(apply, 'hospitalityBookingCommercialAmendment');
  assert.equal(amendmentBlocks.length, 1);
  assertFields(amendmentBlocks[0], [
    'id',
    'organizationId',
    'bookingId',
    'status',
    'bookingVersion',
    'selectionFingerprint',
    'adjustmentFingerprint',
    'paymentProviderCode',
    'direction',
    'currency',
    'beforeTotalMinor',
    'afterTotalMinor',
    'deltaMinor',
    'propertyId',
    'currentRoomTypeId',
    'currentRatePlanId',
    'currentQuantity',
    'targetRoomTypeId',
    'targetRatePlanId',
    'targetQuantity',
    'targetHoldId',
    'protectionQuantity',
    'expiresAt',
  ], 'Amendment apply mutation');
  assert.match(amendmentBlocks[0], /status:\s*'PREPARED'/);
  assert.doesNotMatch(apply, /hospitalityBookingCommercialAmendment\.update\(\{\s*where:\s*\{\s*id:\s*[^,}\n]+\s*\},/);

  assert.match(apply, /organizationId_bookingId:\s*\{/);
  assert.match(apply, /releaseHospitalityAvailabilityHoldInTransaction/);
  assert.match(apply, /deriveHospitalityCommercialAmendmentSettlementState/);
  assert.match(apply, /permission: 'booking:manage'/);
  assert.match(apply, /permission: 'payment:manage'/);
  assert.match(apply, /isolationLevel: 'Serializable'/);
});

test('documentation preserves lifecycle, tenant, and validation boundaries', () => {
  const document = source('docs/commercial-amendment-lifecycle-write-scope.md');
  assert.match(document, /defense-in-depth persistence boundary/i);
  assert.match(document, /final booking mutation/i);
  assert.match(document, /final amendment mutation/i);
  assert.match(document, /target hold release/i);
  assert.match(document, /PostgreSQL/i);
  assert.match(document, /GitHub Actions are intentionally not used/i);
});
