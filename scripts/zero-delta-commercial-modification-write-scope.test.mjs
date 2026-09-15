import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = fs.readFileSync(
  path.join(root, 'src/server/bookings/hospitality-booking-commercial-modification-service.ts'),
  'utf8',
);
const document = fs.readFileSync(
  path.join(root, 'docs/zero-delta-commercial-modification-write-scope.md'),
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

test('zero-delta booking mutation retains tenant, lifecycle, version, commercial terms, and exact money', () => {
  const blocks = mutationWhereBlocks(source, 'hospitalityBooking');
  assert.equal(blocks.length, 1);
  assertFields(blocks[0], [
    'id',
    'organizationId',
    'status',
    'updatedAt',
    'propertyId',
    'roomTypeId',
    'ratePlanId',
    'arrivalDate',
    'departureDate',
    'quantity',
    'paymentStatus',
    'currency',
    'accommodationSubtotalMinor',
    'taxTotalMinor',
    'feeTotalMinor',
    'addonTotalMinor',
    'totalMinor',
    'pricingFingerprint',
  ], 'booking mutation');
  assert.match(blocks[0], /status:\s*'CONFIRMED'/);
  assert.match(blocks[0], /updatedAt:\s*booking\.updatedAt/);
  assert.doesNotMatch(source, /hospitalityBooking\.update\(\{\s*where:\s*\{\s*id:\s*booking\.id\s*\},/);
});

test('retained allocation must match the booking snapshot and final allocation write repeats that snapshot', () => {
  assert.match(source, /const allocation = booking\.allocation;/);
  for (const field of ['organizationId', 'bookingId', 'propertyId', 'roomTypeId', 'quantity', 'arrivalDate', 'departureDate']) {
    assert.match(source, new RegExp(`allocation\\.${field}`), `allocation coherence must compare ${field}`);
  }
  assert.match(source, /Booking allocation no longer matches the confirmed booking snapshot/);

  const blocks = mutationWhereBlocks(source, 'hospitalityBookingAllocation');
  assert.equal(blocks.length, 1);
  assertFields(blocks[0], [
    'organizationId_bookingId',
    'organizationId',
    'bookingId',
    'propertyId',
    'roomTypeId',
    'arrivalDate',
    'departureDate',
    'quantity',
  ], 'allocation mutation');
});

test('zero-delta workflow preserves authorization, locks, pricing, idempotency, evidence, audit, and serializable execution', () => {
  assert.match(source, /permission: 'booking:manage'/);
  assert.match(source, /hospitalityBookingMutationLockKey/);
  assert.match(source, /hospitalityBookingCommercialAllocationLockKeys/);
  assert.match(source, /findActiveHospitalityBookingCommercialAmendment/);
  assert.match(source, /status:\s*\{\s*in:\s*\['PENDING', 'AMBIGUOUS'\]\s*\}/);
  assert.match(source, /hospitalityBookingPriceSnapshotMatches\(booking, latestPrice\)/);
  assert.match(source, /BOOKING_COMMERCIAL_MODIFICATION/);
  assert.match(source, /booking\.commercial-modified/);
  assert.match(source, /modificationFingerprint/);
  assert.match(source, /isolationLevel: 'Serializable'/);
});

test('documentation records the production boundary and validation limits', () => {
  assert.match(document, /Final booking mutation/);
  assert.match(document, /Final allocation mutation/);
  assert.match(document, /Booking and allocation coherence/);
  assert.match(document, /pricing evidence/i);
  assert.match(document, /PostgreSQL/i);
  assert.match(document, /GitHub Actions are intentionally not used/);
});
