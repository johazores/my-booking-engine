import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const reviewService = read('src/server/bookings/rental-booking-reschedule-authority-service.ts');
const writeService = read('src/server/bookings/rental-booking-reschedule-service.ts');
const migration = read('prisma/migrations/20260919013000-rental-post-commercial-neutral-reschedule/migration.sql');
const page = read('app/inventory/rentals/bookings/[booking-id]/reschedule/page.tsx');
const docs = read('docs/rental-booking-reschedule-authority.md');
const commercialDocs = read('docs/rental-booking-commercial-amendments.md');

test('review derives applied effective money and only blocks a second price change', () => {
  assert.match(reviewService, /effectiveAcceptedTotalMinor = existingCommercialAmendment\.afterTotalMinor/);
  assert.match(reviewService, /latestReschedule\.totalMinor !== existingCommercialAmendment\.afterTotalMinor/);
  assert.match(reviewService, /acceptedTotalMinor: effectiveAcceptedTotalMinor/);
  assert.match(reviewService, /commercialImpact\.kind !== 'UNCHANGED'[\s\S]*COMMERCIAL_AMENDMENT_APPLIED/);
  assert.doesNotMatch(reviewService, /else if \(existingCommercialAmendment\?\.status === 'APPLIED'\) blocker/);
  assert.match(page, /Accepted effective amount/);
  assert.match(page, /Original booking amount/);
  assert.match(page, /price-neutral date change can still be reviewed/);
});

test('writer repeats prepared freeze and applied commercial-baseline authority under the booking lock', () => {
  assert.match(writeService, /rentalBookingLockKey\(input\.organizationId, input\.bookingId\)/);
  assert.match(writeService, /rentalBookingCommercialAmendment\.findMany/);
  assert.match(writeService, /commercialAmendment\?\.status === 'PREPARED'/);
  assert.match(writeService, /effectiveAcceptedTotalMinor = commercialAmendment\.afterTotalMinor/);
  assert.match(writeService, /BigInt\(targetPricing\.totalMinor\) !== effectiveAcceptedTotalMinor/);
  assert.match(writeService, /totalMinor: effectiveAcceptedTotalMinor/);
  assert.match(writeService, /acceptedTotalMinor: effectiveAcceptedTotalMinor\.toString\(\)/);
});

test('postgres preserves effective money while allowing only the exact prepared final-apply reschedule', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION sf_guard_rental_booking_reschedule_insert/);
  assert.match(migration, /commercial_amendment\."status" = 'PREPARED'/);
  assert.match(migration, /NEW\."authorityFingerprint" <> commercial_amendment\."reviewFingerprint"/);
  assert.match(migration, /applying_prepared_commercial := TRUE/);
  assert.match(migration, /effective_total_minor := commercial_amendment\."afterTotalMinor"/);
  assert.match(migration, /previous_reschedule\."totalMinor" <> source_total_minor/);
  assert.match(migration, /NEW\."totalMinor" <> effective_total_minor/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION sf_guard_rental_reschedule_after_commercial_amendment/);
  assert.match(migration, /post-amendment rental reschedule must preserve the accepted effective commercial total/);
  assert.match(migration, /sf_guard_rental_prepared_commercial_reschedule_terminal/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /prepared commercial reschedule must terminalize the linked amendment in the same transaction/);
});

test('documentation distinguishes one price-changing amendment from later price-neutral dates', () => {
  assert.match(docs, /later same-unit date changes are allowed only when/i);
  assert.match(docs, /accepted effective post-amendment total/i);
  assert.match(commercialDocs, /Post-apply date and physical-unit authority/);
  assert.match(commercialDocs, /later same-unit price-neutral reschedules\/extensions and same-type\/same-location pre-custody unit substitutions are supported/i);
});
