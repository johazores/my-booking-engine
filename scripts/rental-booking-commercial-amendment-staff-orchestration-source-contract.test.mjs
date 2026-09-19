import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const reviewPage = read('app/inventory/rentals/bookings/[booking-id]/reschedule/page.tsx');
const amendmentPage = read('app/inventory/rentals/bookings/[booking-id]/commercial-amendments/[amendment-id]/page.tsx');
const prepareRoute = read('app/api/inventory/rentals/bookings/[booking-id]/commercial-amendments/route.ts');
const actionRoute = read('app/api/inventory/rentals/bookings/[booking-id]/commercial-amendments/[amendment-id]/route.ts');
const authorityService = read('src/server/bookings/rental-booking-reschedule-authority-service.ts');
const settlementService = read('src/server/bookings/rental-booking-commercial-amendment-settlement-service.ts');
const docs = read('docs/rental-booking-commercial-amendments.md');

test('price-changing review exposes only the protected preparation handoff', () => {
  assert.match(reviewPage, /commercialAmendmentFingerprint/);
  assert.match(reviewPage, /Prepare commercial amendment/);
  assert.match(reviewPage, /payment:read/);
  assert.match(reviewPage, /payment:manage/);
  assert.match(reviewPage, /reviewFingerprint/);
  assert.match(reviewPage, /commercial-amendments/);
  assert.doesNotMatch(reviewPage, /recordRentalBookingCommercialAmendmentManualSettlement/);
});

test('preparation route derives tenant and actor from authenticated mutation context', () => {
  assert.match(prepareRoute, /prepareInventoryMutationRequest/);
  assert.match(prepareRoute, /booking\.rental\.commercial-amendment\.prepare/);
  assert.match(prepareRoute, /organizationId: organization\.id/);
  assert.match(prepareRoute, /actorUserId: session\.user\.id/);
  assert.match(prepareRoute, /prepareRentalBookingCommercialAmendment/);
  assert.match(prepareRoute, /reviewFingerprint/);
  assert.doesNotMatch(prepareRoute, /organizationId: formField/);
  assert.doesNotMatch(prepareRoute, /actorUserId: formField/);
});

test('commercial amendment workspace wires real settlement, recovery, apply, close, and post-apply refund contracts', () => {
  for (const token of [
    'readRentalBookingCommercialAmendmentSettlement',
    'readRentalBookingEffectiveSettlement',
    'adjustmentRefundSource',
    'Record adjustment payment',
    'Record adjustment refund',
    'Server-selected refund source',
    'Record full compensation',
    'Apply commercial date change',
    'Record post-apply refund',
    'Open existing commercial amendment',
  ]) {
    const surface = `${reviewPage}\n${amendmentPage}`;
    assert.ok(surface.includes(token), `missing staff orchestration token: ${token}`);
  }
  assert.match(amendmentPage, /canManage = hasPermission\('booking:manage'\) && hasPermission\('payment:manage'\)/);
  assert.match(amendmentPage, /canApply = canManage/);
  assert.match(amendmentPage, /availability:manage/);
  assert.match(amendmentPage, /pricing:read/);
  assert.match(amendmentPage, /Record only after/);
  assert.doesNotMatch(amendmentPage, /listRentalBookingPaymentTransactions/);
  assert.doesNotMatch(amendmentPage, /name="sourceProviderReference"/);
});

test('action route keeps money and both refund-source authorities server-side', () => {
  for (const token of [
    'recordRentalBookingCommercialAmendmentManualSettlement',
    'recordRentalBookingCommercialAmendmentManualCompensation',
    'applyRentalBookingCommercialAmendment',
    'cancelRentalBookingCommercialAmendment',
    'recordRentalBookingPostApplyManualRefund',
    'readRentalBookingEffectiveSettlement',
    'parseMoneyMajorToMinor',
  ]) assert.ok(actionRoute.includes(token), `missing action boundary: ${token}`);

  assert.match(actionRoute, /organizationId: organization\.id/);
  assert.match(actionRoute, /actorUserId: session\.user\.id/);
  assert.match(actionRoute, /effective\.appliedAmendment\.id !== amendmentId/);
  assert.match(actionRoute, /effective\.settlement\.currency/);
  assert.match(actionRoute, /confirmation.*APPLY/s);
  assert.doesNotMatch(actionRoute, /currency: formField/);
  assert.doesNotMatch(actionRoute, /amountMinor: formField/);
  assert.doesNotMatch(actionRoute, /sourceProviderReference/);
});

test('prepared readiness uses database time and the write path repeats expiry authority', () => {
  assert.match(settlementService, /SELECT clock_timestamp\(\) AS "now"/);
  assert.match(settlementService, /preparationLive = amendment\.status === 'PREPARED' && amendment\.expiresAt > clock\.now/);
  assert.match(settlementService, /amendment\.expiresAt <= clock\.now/);
  assert.match(amendmentPage, /const preparationLive = commercial\.preparationLive/);
  assert.doesNotMatch(amendmentPage, /Date\.now\(\)/);
});

test('review freezes prepared authority but keeps price-neutral post-apply date changes live', () => {
  assert.match(authorityService, /COMMERCIAL_AMENDMENT_ACTIVE/);
  assert.match(authorityService, /COMMERCIAL_AMENDMENT_APPLIED/);
  assert.match(authorityService, /rentalBookingCommercialAmendment\.findMany/);
  assert.match(authorityService, /status: \{ in: \['PREPARED', 'APPLIED'\] \}/);
  assert.match(authorityService, /effectiveAcceptedTotalMinor = existingCommercialAmendment\.afterTotalMinor/);
  assert.match(authorityService, /commercialImpact\.kind !== 'UNCHANGED'[\s\S]*COMMERCIAL_AMENDMENT_APPLIED/);
  assert.match(reviewPage, /price-neutral date change can still be reviewed/);
  assert.match(reviewPage, /Open existing commercial amendment/);
});

test('documentation describes the real manual staff workflow without claiming online provider execution', () => {
  assert.match(docs, /staff orchestration/i);
  assert.match(docs, /manual\/offline/i);
  assert.match(docs, /does not collect or refund money/i);
  assert.match(docs, /server-derived source/i);
  assert.match(docs, /PostgreSQL time/i);
  assert.match(docs, /provider-backed\/online/i);
  assert.doesNotMatch(docs, /not exposed as a primary staff action/i);
});
