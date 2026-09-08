import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('reviewed second sell consumes one accepted decision only at the provider-request boundary', () => {
  const coordinator = source('src/server/suppliers/travelport-stays-reservation-reviewed-create-service.ts');
  const consumption = source('src/server/suppliers/hospitality-supplier-reservation-review-consumption-service.ts');

  const reviewIndex = coordinator.indexOf('reviewTravelportStaysReservationAcceptedCommercialAuthority');
  const requestMaterialIndex = coordinator.indexOf('buildTravelportStaysReservationCreateRequestMaterial', reviewIndex);
  const paymentSourceIndex = coordinator.indexOf('acquireTravelportStaysReservationPaymentCard', requestMaterialIndex);
  const executorIndex = coordinator.indexOf('createReservationAfterAcceptedReview', paymentSourceIndex);
  const consumeIndex = coordinator.indexOf('consumeHospitalitySupplierReservationReviewAcceptanceForProviderRequest', executorIndex);
  assert.ok(
    reviewIndex >= 0
      && requestMaterialIndex > reviewIndex
      && paymentSourceIndex > requestMaterialIndex
      && executorIndex > paymentSourceIndex
      && consumeIndex > executorIndex,
  );

  assert.match(coordinator, /const attemptId = randomUUID\(\)/);
  assert.match(coordinator, /expectedAcceptanceFingerprint: reviewed\.storedAcceptance\.acceptance\.acceptanceFingerprint/);
  assert.match(coordinator, /acceptedReview,/);
  assert.match(coordinator, /purpose: 'REVIEW_ACCEPTANCE_CREATE'/);
  assert.doesNotMatch(coordinator, /paymentCard:\s*TravelportStaysSensitiveReservationPaymentCard|paymentCard:\s*input\.paymentCard/);
  assert.doesNotMatch(coordinator, /reviewAndClaimHospitalitySupplierReservationSubmission/);
  assert.doesNotMatch(coordinator, /markHospitalitySupplierReservationProviderRequestStarted/);
  assert.match(coordinator, /settlement\.status === 'FAILED'/);
  assert.match(coordinator, /retryable: false/);

  assert.match(consumption, /pg_advisory_xact_lock/);
  assert.match(consumption, /assertHospitalitySupplierReservationStoredReviewAcceptance/);
  assert.match(consumption, /assertHospitalitySupplierReservationReviewAttemptAuthority/);
  assert.match(consumption, /hospitalitySupplierReservationReviewAcceptanceHistory\.create/);
  assert.match(consumption, /kind: 'CREATE'/);
  assert.match(consumption, /status: 'STARTED'/);
  assert.match(consumption, /leaseStartedAt: providerRequestStartedAt/);
  assert.match(consumption, /providerRequestStartedAt,/);
  assert.match(consumption, /attemptCount: sequence/);
  assert.match(consumption, /status: 'SUBMITTING'/);
  assert.match(consumption, /action: 'supplier\.reservation-reviewed-provider-request-started'/);
});

test('consumption preserves accepted evidence and clears only the active acceptance slot', () => {
  const consumption = source('src/server/suppliers/hospitality-supplier-reservation-review-consumption-service.ts');
  const schema = source('prisma/hospitality-supplier-reservations.prisma');
  const migration = source('prisma/migrations/20260908073000_supplier-reservation-review-consumption/migration.sql');

  for (const field of [
    'acceptedAt',
    'acceptedByUserId',
    'reviewAttemptSequence',
    'reason',
    'acceptPriceChange',
    'acceptGuaranteeChange',
    'currency',
    'acceptedTotalMinor',
    'acceptedOfferFingerprint',
    'acceptedTermsFingerprint',
    'acceptedAuthorityFingerprint',
    'acceptanceFingerprint',
    'consumedAt',
    'consumedAttemptSequence',
  ]) {
    assert.match(consumption, new RegExp(`${field}:`));
    assert.match(schema, new RegExp(`\\b${field}\\b`));
  }

  for (const field of [
    'reviewAcceptedAt',
    'reviewAcceptedByUserId',
    'reviewAcceptedAttemptSequence',
    'reviewAcceptedPriceChange',
    'reviewAcceptedGuaranteeChange',
    'reviewAcceptedCurrency',
    'reviewAcceptedTotalMinor',
    'reviewAcceptedOfferFingerprint',
    'reviewAcceptedTermsFingerprint',
    'reviewAcceptedAuthorityFingerprint',
    'reviewAcceptanceFingerprint',
  ]) {
    assert.match(consumption, new RegExp(`${field}: null`));
  }

  assert.match(schema, /HospitalitySupplierReservationReviewAcceptanceHistory/);
  assert.match(schema, /SupplierReservationReviewAcceptanceConsumedAttempt/);
  assert.match(schema, /@@unique\(\[organizationId, reservationId, reviewAttemptSequence\]/);
  assert.match(schema, /@@unique\(\[organizationId, reservationId, consumedAttemptSequence\]/);
  assert.match(schema, /@@unique\(\[organizationId, reservationId, acceptanceFingerprint\]/);
  assert.match(migration, /consumedAttemptSequence" = "reviewAttemptSequence" \+ 1/);
  assert.match(migration, /FOREIGN KEY \("organizationId", "reservationId", "consumedAttemptSequence"\)/);
  assert.match(migration, /SUPPLIER_PRICE_AND_GUARANTEE_CHANGED/);
});

test('reviewed executor sends only explicitly accepted Travelport second-request query flags', () => {
  const executor = source('src/server/suppliers/travelport-stays-reservation-create-executor.ts');

  const initialStart = executor.indexOf('async createReservation(input:');
  const reviewedStart = executor.indexOf('async createReservationAfterAcceptedReview', initialStart);
  const commonStart = executor.indexOf('async #createReservation', reviewedStart);
  assert.ok(initialStart >= 0 && reviewedStart > initialStart && commonStart > reviewedStart);
  assert.match(executor.slice(initialStart, reviewedStart), /#createReservation\(input, null\)/);
  assert.doesNotMatch(executor.slice(initialStart, reviewedStart), /acceptedReview/);
  assert.match(executor.slice(reviewedStart, commonStart), /#createReservation\(input, input\.acceptedReview\)/);

  assert.match(executor, /query\.set\('acceptPriceChangeInd', 'true'\)/);
  assert.match(executor, /query\.set\('acceptGuaranteeChangeInd', 'true'\)/);
  assert.doesNotMatch(executor, /acceptPriceChangeInd[^\n]*false|acceptGuaranteeChangeInd[^\n]*false/);
  assert.match(executor, /\(!acceptedReview\.acceptPriceChange && !acceptedReview\.acceptGuaranteeChange\)/);

  const requestIndex = executor.indexOf('const requestBody = buildTravelportStaysReservationCreateRequest');
  const urlIndex = executor.indexOf('const reservationUrl = reviewedReservationBuildUrl', requestIndex);
  const tokenIndex = executor.indexOf('const accessToken = await this.#accessToken()', urlIndex);
  const markerIndex = executor.indexOf('await input.beforeProviderRequest()', tokenIndex);
  const fetchIndex = executor.indexOf('response = await this.#fetchImpl(reservationUrl', markerIndex);
  assert.ok(requestIndex >= 0 && urlIndex > requestIndex && tokenIndex > urlIndex && markerIndex > tokenIndex && fetchIndex > markerIndex);
});

test('reviewed second sell keeps the reservation capability closed and requires an external payment source capability', () => {
  const coordinator = source('src/server/suppliers/travelport-stays-reservation-reviewed-create-service.ts');
  const paymentSource = source('src/server/suppliers/travelport-stays-reservation-payment-card-source.ts');
  const provider = source('src/server/suppliers/travelport-stays-provider.ts');
  const integrationDocs = source('docs/travelport-stays-integration.md');

  assert.match(coordinator, /Server-only one-time second-sell path/);
  assert.match(coordinator, /paymentCardSource: TravelportStaysReservationPaymentCardSource/);
  assert.match(coordinator, /Form-of-payment material is acquired only through a separately supplied server capability/);
  assert.match(paymentSource, /This contract[\s\S]*is not a token[\s\S]*or evidence that SF is PCI-ready/);
  assert.match(provider, /capabilities: Object\.freeze\(\['availability', 'hotel-search', 'pricing'\]/);
  assert.doesNotMatch(provider, /capabilities: Object\.freeze\([^\n]*'reservation'/);
  assert.match(integrationDocs, /reservation.*(?:disabled|unadvertised|not advertised)/i);
  assert.match(integrationDocs, /PCI/i);
});
