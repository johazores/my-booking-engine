import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

function assertMaterializesBefore(sourceText, functionName, materializer, firstAuthorityCall) {
  const functionIndex = sourceText.indexOf(`export async function ${functionName}`);
  const materializerIndex = sourceText.indexOf(`${materializer}(input)`, functionIndex);
  const authorityIndex = sourceText.indexOf(firstAuthorityCall, functionIndex);
  assert.ok(functionIndex >= 0, `${functionName} must exist`);
  assert.ok(materializerIndex > functionIndex, `${functionName} must materialize its input`);
  assert.ok(authorityIndex > materializerIndex, `${functionName} must materialize before authorization or external authority work`);
}

test('provider-neutral reservation ledger materializes all commercial write boundaries before authorization', async () => {
  const service = await source('src/server/suppliers/hospitality-supplier-reservation-service.ts');
  assertMaterializesBefore(service, 'prepareHospitalitySupplierReservation', 'materializeHospitalitySupplierReservationPreparationInput', 'await requireSupplierReservationAuthority');
  assertMaterializesBefore(service, 'claimHospitalitySupplierReservationSubmission', 'materializeHospitalitySupplierReservationScope', 'await requireSupplierReservationAuthority');
  assertMaterializesBefore(service, 'settleHospitalitySupplierReservationSubmission', 'materializeHospitalitySupplierReservationSubmissionSettlementInput', 'await requireSupplierReservationAuthority');
  assertMaterializesBefore(service, 'claimHospitalitySupplierReservationReconciliation', 'materializeHospitalitySupplierReservationScope', 'await requireSupplierReservationAuthority');
  assertMaterializesBefore(service, 'settleHospitalitySupplierReservationReconciliation', 'materializeHospitalitySupplierReservationReconciliationSettlementInput', 'await requireSupplierReservationAuthority');
});

test('review and accepted-review durable boundaries materialize before permission checks', async () => {
  const [review, consumption] = await Promise.all([
    source('src/server/suppliers/hospitality-supplier-reservation-review-service.ts'),
    source('src/server/suppliers/hospitality-supplier-reservation-review-consumption-service.ts'),
  ]);
  assertMaterializesBefore(review, 'settleHospitalitySupplierReservationReviewRequired', 'materializeHospitalitySupplierReservationReviewRequiredInput', 'assertUuidIdentifier');
  assertMaterializesBefore(consumption, 'consumeHospitalitySupplierReservationReviewAcceptanceForProviderRequest', 'materializeHospitalitySupplierReservationReviewConsumptionInput', 'await requireReviewConsumptionAuthority');
});

test('authority and commercial-review services freeze caller input before awaits', async () => {
  const [authority, acceptance, acceptedReview] = await Promise.all([
    source('src/server/suppliers/hospitality-supplier-reservation-authority-service.ts'),
    source('src/server/suppliers/travelport-stays-reservation-review-acceptance-service.ts'),
    source('src/server/suppliers/travelport-stays-reservation-review-consumption-authority-service.ts'),
  ]);
  assertMaterializesBefore(authority, 'reviewHospitalitySupplierReservationAuthority', 'materializeHospitalitySupplierReservationAuthorityReviewInput', 'await requireSupplierReservationReviewAuthority');
  assertMaterializesBefore(authority, 'prepareHospitalitySupplierReservationWithTravelerAuthority', 'materializeHospitalitySupplierReservationPreparationWithTravelerInput', 'await requireSupplierReservationReviewAuthority');
  assertMaterializesBefore(authority, 'reviewAndClaimHospitalitySupplierReservationSubmission', 'materializeHospitalitySupplierReservationReviewAndClaimInput', 'await requireSupplierReservationReviewAuthority');
  assertMaterializesBefore(acceptance, 'acceptTravelportStaysReservationCommercialReview', 'materializeHospitalitySupplierReservationCommercialReviewAcceptanceInput', 'await requireReviewAcceptanceAuthority');
  assertMaterializesBefore(acceptedReview, 'reviewTravelportStaysReservationAcceptedCommercialAuthority', 'materializeHospitalitySupplierReservationAcceptedReviewInput', 'await requireReviewConsumptionAuthority');
});

test('Travelport create, reviewed create, and Sync coordinators freeze identity before their first operation', async () => {
  const [create, reviewedCreate, sync] = await Promise.all([
    source('src/server/suppliers/travelport-stays-reservation-create-service.ts'),
    source('src/server/suppliers/travelport-stays-reservation-reviewed-create-service.ts'),
    source('src/server/suppliers/travelport-stays-reservation-sync-service.ts'),
  ]);
  assertMaterializesBefore(create, 'createTravelportStaysReservationWithSensitivePaymentCard', 'materializeHospitalitySupplierReservationReviewAndClaimInput', 'await reviewAndClaimHospitalitySupplierReservationSubmission');
  assertMaterializesBefore(reviewedCreate, 'createTravelportStaysReservationAfterAcceptedCommercialReviewWithSensitivePaymentCard', 'materializeHospitalitySupplierReservationAcceptedReviewInput', 'await reviewTravelportStaysReservationAcceptedCommercialAuthority');
  assertMaterializesBefore(sync, 'syncTravelportStaysBookingDotComReservation', 'materializeHospitalitySupplierReservationReviewAndClaimInput', 'normalizeHospitalitySupplierReservationTravelerPayload');
});

test('materializer is frozen, sanitized, nested-aware, and branch-specific', async () => {
  const authority = await source('src/server/suppliers/hospitality-supplier-reservation-input-authority.ts');
  assert.match(authority, /Supplier reservation request authority is invalid\./);
  assert.match(authority, /catch \{\s*invalidAuthority\(\)/s);
  assert.match(authority, /Object\.freeze\(Array\.from\(value\)\)/);
  assert.match(authority, /telephone: Object\.freeze\(\{/);
  assert.match(authority, /if \(status === 'CONFIRMED'\)/);
  assert.match(authority, /else if \(status === 'FAILED'\)/);
  assert.match(authority, /typeof outcomeRecord\.retryable !== 'boolean'/);
  assert.match(authority, /else if \(status === 'AMBIGUOUS'\)/);
  assert.match(authority, /else if \(status === 'NOT_FOUND'\)/);
  assert.doesNotMatch(authority, /throw error/);
});

test('documentation records tenant TOCTOU, authorization, privacy, and activation limits', async () => {
  const docs = await source('docs/supplier-reservation-input-authority.md');
  assert.match(docs, /tenant authority/i);
  assert.match(docs, /authorize tenant A and later persist or query tenant B/i);
  assert.match(docs, /Materialization is not authorization/);
  assert.match(docs, /server-side `booking:manage`/);
  assert.match(docs, /PAN\/CVV/);
  assert.match(docs, /Travelport `reservation` remains deliberately disabled/);
});
