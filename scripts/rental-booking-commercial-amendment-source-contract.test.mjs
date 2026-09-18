import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('prisma/rental-booking-commercial-amendments.prisma', 'utf8');
const rentalSchema = readFileSync('prisma/rental-inventory.prisma', 'utf8');
const migration = readFileSync('prisma/migrations/20260918083000_rental-booking-commercial-amendment-preparation/migration.sql', 'utf8');
const domain = readFileSync('src/server/bookings/rental-booking-commercial-amendment-domain.ts', 'utf8');
const review = readFileSync('src/server/bookings/rental-booking-reschedule-authority-service.ts', 'utf8');
const service = readFileSync('src/server/bookings/rental-booking-commercial-amendment-service.ts', 'utf8');
const docs = readFileSync('docs/rental-booking-commercial-amendments.md', 'utf8');

test('commercial amendment persistence is tenant-owned, single-active, immutable commercial evidence', () => {
  for (const token of [
    'model RentalBookingCommercialAmendment',
    'PREPARED',
    'CANCELLED',
    'EXPIRED',
    'APPLIED',
    '@@unique([organizationId, idempotencyKey]',
    '@@index([organizationId, bookingId, status, expiresAt]',
  ]) assert.ok(schema.includes(token), `missing schema token: ${token}`);
  assert.match(schema, /booking\s+RentalBooking\s+@relation\(fields: \[bookingId, organizationId\], references: \[id, organizationId\]/);
  assert.match(rentalSchema, /commercialAmendments\s+RentalBookingCommercialAmendment\[\]/);

  assert.match(migration, /rental_booking_commercial_amendments_org_booking_prepared_key/);
  assert.match(migration, /WHERE "status" = 'PREPARED'/);
  assert.match(migration, /rental_booking_commercial_amendments_money_check/);
  assert.match(migration, /rental_booking_commercial_amendments_custody_shape_check/);
  assert.match(migration, /rental_booking_commercial_amendments_lifecycle_check/);
  assert.match(migration, /sf_guard_rental_booking_commercial_amendment_terms/);
  assert.match(migration, /commercial amendment evidence is append-only/);
});

test('price-changing review creates stale-safe commercial authority only for same-currency price changes', () => {
  assert.match(domain, /buildRentalBookingCommercialAmendmentReviewFingerprint/);
  assert.match(domain, /bookingUpdatedAt/);
  assert.match(domain, /beforeTotalMinor/);
  assert.match(domain, /afterTotalMinor/);
  assert.match(domain, /sourcePricingFingerprint/);
  assert.match(domain, /targetPricingFingerprint/);
  assert.match(domain, /pickupEventId/);
  assert.match(review, /commercialAmendmentFingerprint = blocker === 'PRICE_CHANGED'/);
  assert.match(review, /commercialImpact\.kind === 'INCREASE' \|\| commercialImpact\.kind === 'DECREASE'/);
  assert.match(review, /buildRentalBookingCommercialAmendmentReviewFingerprint\(\{/);
  assert.match(review, /commercialAmendmentFingerprint,/);
});

test('preparation revalidates tenant lifecycle inventory pricing custody and fully paid settlement under locks', () => {
  for (const permission of ['booking:manage', 'availability:read', 'inventory:read', 'pricing:read', 'payment:manage']) {
    assert.ok(service.includes(`permission: '${permission}'`), `missing permission ${permission}`);
  }
  assert.match(service, /rentalBookingLockKey\(input\.organizationId, input\.bookingId\)/);
  assert.match(service, /rentalUnitLockKey\(input\.organizationId, effectiveUnitId\)/);
  assert.match(service, /SELECT clock_timestamp\(\) AS "now"/);
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /findOverdueRentalCustodyUnitIds/);
  assert.match(service, /buildRentalPricingEvidence\(\{/);
  assert.match(service, /buildRentalBookingRescheduleCommercialImpact\(\{/);
  assert.match(service, /expectedReviewFingerprint !== target\.reviewFingerprint/);
  assert.match(service, /readRentalPaymentSettlementHistory\(\{/);
  assert.match(service, /settlement\.paymentState !== 'PAID'/);
  assert.match(service, /settlement\.netSettledMinor !== booking\.totalMinor/);
  assert.match(service, /rentalBookingCommercialAmendment\.create\(\{/);
  assert.match(service, /booking\.rental\.commercial-amendment\.prepared/);
  assert.match(service, /booking\.rental\.commercial-amendment\.cancelled/);
  assert.match(service, /booking\.rental\.commercial-amendment\.expired/);
});

test('preparation documentation keeps commercial orchestration outside the current product surface', () => {
  assert.match(docs, /does \*\*not\*\* expose a staff prepare button/i);
  assert.match(docs, /No route or primary staff action exposes preparation, settlement, compensation, or final apply yet/i);
  assert.match(docs, /Preparation itself does not mutate the booking or allocation/i);
  assert.match(docs, /does not collect money/i);
});
