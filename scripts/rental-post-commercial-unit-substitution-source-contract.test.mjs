import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const authority = read('src/server/bookings/rental-booking-unit-substitution-authority-service.ts');
const writer = read('src/server/bookings/rental-booking-unit-substitution-service.ts');
const page = read('app/inventory/rentals/bookings/[booking-id]/unit-substitution/page.tsx');
const migration = read('prisma/migrations/20260919022000-rental-post-commercial-unit-substitution/migration.sql');
const docs = read('docs/rental-booking-unit-substitution-authority.md');
const commercialDocs = read('docs/rental-booking-commercial-amendments.md');

test('candidate and review authority reconcile one applied amendment into the effective substitution baseline', () => {
  assert.match(authority, /readUnitSubstitutionCommercialBaseline/);
  assert.match(authority, /rentalBookingCommercialAmendment\.findMany/);
  assert.match(authority, /take: 2/);
  assert.match(authority, /amendments\.length > 1/);
  assert.match(authority, /amendment\?\.status === 'PREPARED'/);
  assert.match(authority, /amendment\?\.status === 'APPLIED'/);
  assert.match(authority, /amendment\.beforeTotalMinor !== input\.booking\.totalMinor/);
  assert.match(authority, /input\.latestReschedule\.totalMinor !== amendment\.afterTotalMinor/);
  assert.match(authority, /input\.latestReschedule\.appliedAt\.getTime\(\) < amendment\.appliedAt\.getTime\(\)/);
  assert.match(authority, /totalMinor: amendment\.afterTotalMinor/);
  assert.match(authority, /appliedCommercialAmendmentId: amendment\.id/);
  assert.match(authority, /currency: commercialBaseline\.currency/);
  assert.match(authority, /totalMinor: commercialBaseline\.totalMinor/);
  assert.match(authority, /originalTotalMinor: commercialBaseline\.originalTotalMinor/);
});

test('writer repeats applied baseline authority under the shared booking and unit locks', () => {
  assert.match(writer, /rentalBookingLockKey\(input\.organizationId, input\.bookingId\)/);
  assert.match(writer, /lockRentalUnits\(transaction, input\.organizationId/);
  assert.match(writer, /rentalBookingCommercialAmendment\.findMany/);
  assert.match(writer, /commercialAmendments\.length > 1/);
  assert.match(writer, /commercialAmendment\?\.status === 'PREPARED'/);
  assert.match(writer, /commercialAmendment\?\.status === 'APPLIED'/);
  assert.match(writer, /effectiveCurrency = commercialAmendment\.currency/);
  assert.match(writer, /effectiveAcceptedTotalMinor = commercialAmendment\.afterTotalMinor/);
  assert.match(writer, /latestReschedule\.totalMinor !== commercialAmendment\.afterTotalMinor/);
  assert.match(writer, /currency: effectiveCurrency/);
  assert.match(writer, /totalMinor: effectiveAcceptedTotalMinor/);
  assert.match(writer, /acceptedTotalMinor: effectiveAcceptedTotalMinor\.toString\(\)/);
  assert.match(writer, /appliedCommercialAmendmentId/);
});

test('postgres replaces the blanket amendment guard with exact effective-commercial substitution authority', () => {
  assert.match(migration, /DROP TRIGGER IF EXISTS rental_booking_unit_substitutions_commercial_amendment_guard/);
  assert.match(migration, /DROP FUNCTION IF EXISTS sf_guard_rental_unit_substitution_during_commercial_amendment/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION sf_guard_rental_booking_unit_substitution_insert/);
  assert.match(migration, /active_amendment_count > 1/);
  assert.match(migration, /commercial_amendment\."status" = 'PREPARED'/);
  assert.match(migration, /effective_total_minor := commercial_amendment\."afterTotalMinor"/);
  assert.match(migration, /latest_reschedule\."totalMinor" <> effective_total_minor/);
  assert.match(migration, /latest_reschedule\."appliedAt" < commercial_amendment\."appliedAt"/);
  assert.match(migration, /NEW\."currency" <> effective_currency/);
  assert.match(migration, /NEW\."totalMinor" <> effective_total_minor/);
  assert.match(migration, /NEW\."pricingFingerprint" <> expected_pricing_fingerprint/);
  assert.match(migration, /rental unit substitution target overlaps another active booking/);
  assert.doesNotMatch(migration, /status" IN \('PREPARED', 'APPLIED'\)[\s\S]*requires a separate effective-commercial-baseline contract/);
});

test('staff review communicates effective money without rewriting original booking evidence', () => {
  assert.match(page, /Accepted effective amount remains unchanged/);
  assert.match(page, /Original booking amount/);
  assert.match(page, /Open applied commercial amendment/);
  assert.match(page, /effective commercial baseline/);
  assert.match(page, /immutable booking-time unit and money remain retained as historical evidence/);
});

test('documentation describes post-amendment substitution as supported only on the accepted effective baseline', () => {
  assert.match(docs, /applied commercial amendment/i);
  assert.match(docs, /accepted effective amount/i);
  assert.match(docs, /`PREPARED` commercial amendment/);
  assert.match(commercialDocs, /post-apply physical-unit substitution/i);
  assert.match(commercialDocs, /same retained unit type at the same retained operating location/i);
});
