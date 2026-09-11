import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Travelport create coordinator uses fresh authority, exact current integration, deferred card source, durable marker, and ledger settlement in order', () => {
  const coordinator = source('src/server/suppliers/travelport-stays-reservation-create-service.ts');
  const review = coordinator.indexOf('await reviewAndClaimHospitalitySupplierReservationSubmission');
  const reload = coordinator.indexOf('await loadTravelportStaysIntegration', review);
  const exactMatch = coordinator.indexOf('assertExecutionIntegrationStillMatches', reload);
  const providerCall = coordinator.indexOf('await execution.reservationCreateExecutor.createReservation', exactMatch);
  const paymentSource = coordinator.indexOf('acquirePaymentCard: () => acquireTravelportStaysReservationPaymentCard', providerCall);
  const marker = coordinator.indexOf('await markHospitalitySupplierReservationProviderRequestStarted', paymentSource);
  const reviewSettlement = coordinator.indexOf('settleHospitalitySupplierReservationReviewRequired', marker);
  const map = coordinator.indexOf('travelportStaysCreateOutcomeToSubmissionOutcome', reviewSettlement);
  const settle = coordinator.indexOf('settleHospitalitySupplierReservationSubmission', map);

  assert.ok(
    review >= 0
      && reload > review
      && exactMatch > reload
      && providerCall > exactMatch
      && paymentSource > providerCall
      && marker > paymentSource
      && reviewSettlement > marker
      && map > reviewSettlement
      && settle > map,
  );
  assert.match(coordinator, /requestCorrelationId: claim\.attempt\.id/);
  assert.match(coordinator, /attemptId: claim\.attempt\.id/);
  assert.match(coordinator, /integration\.credentialVersion !== reservation\.integrationCredentialVersion/);
  assert.match(coordinator, /!integration\.capabilities\.includes\('reservation'\)/);
});

test('pre-provider retryability is classifier-owned while every post-marker unexpected failure remains ambiguous', () => {
  const coordinator = source('src/server/suppliers/travelport-stays-reservation-create-service.ts');
  assert.match(coordinator, /classifyHospitalitySupplierPreProviderFailure\(input\.error\)/);
  assert.match(coordinator, /failureCode: failure\.failureCode/);
  assert.match(coordinator, /retryable: failure\.retryable/);
  assert.match(coordinator, /if \(!providerRequestStarted\)[\s\S]*?settlePreProviderFailure/);
  assert.doesNotMatch(coordinator, /status: 'FAILED',[\s\S]{0,120}retryable: true/);
  assert.match(coordinator, /providerRequestStarted = true/);
  assert.match(coordinator, /status: 'AMBIGUOUS',[\s\S]*?failureCode: 'INVALID_RESPONSE'/);
  assert.match(coordinator, /observationState\.current\?\.finish\('AMBIGUOUS'\)/);
  assert.match(coordinator, /if \(!providerRequestStarted\) \{[\s\S]*?markHospitalitySupplierReservationProviderRequestStarted[\s\S]*?postProviderUnexpectedOutcome/);
});

test('documented price and guarantee changes persist as dedicated review-required state without generic retry authority', () => {
  const coordinator = source('src/server/suppliers/travelport-stays-reservation-create-service.ts');
  const reviewService = source('src/server/suppliers/hospitality-supplier-reservation-review-service.ts');
  const domain = source('src/server/suppliers/hospitality-supplier-reservation-domain.ts');

  assert.match(coordinator, /createOutcome\.status === 'REVIEW_REQUIRED'/);
  assert.match(coordinator, /settleHospitalitySupplierReservationReviewRequired/);
  assert.match(reviewService, /providerRequestStartedAt/);
  assert.match(reviewService, /status: 'REVIEW_REQUIRED'/);
  assert.match(reviewService, /lastFailureRetryable: null/);
  assert.match(domain, /input\.status === 'REVIEW_REQUIRED'/);
  assert.match(domain, /explicit price or guarantee review decision/);
  assert.doesNotMatch(coordinator, /acceptPriceChangeInd|acceptGuaranteeChangeInd/);
});

test('sensitive form of payment is a deferred source callback instead of coordinator input state', () => {
  const coordinator = source('src/server/suppliers/travelport-stays-reservation-create-service.ts');
  const executor = source('src/server/suppliers/travelport-stays-reservation-create-executor.ts');
  const paymentSource = source('src/server/suppliers/travelport-stays-reservation-payment-card-source.ts');
  const observability = source('src/server/suppliers/travelport-stays-reservation-create-observability.ts');
  const integration = source('src/server/suppliers/travelport-stays-provider.ts');

  assert.match(coordinator, /paymentCardSource: TravelportStaysReservationPaymentCardSource/);
  assert.match(coordinator, /acquirePaymentCard: \(\) => acquireTravelportStaysReservationPaymentCard/);
  assert.match(coordinator, /purpose: 'INITIAL_CREATE'/);
  assert.doesNotMatch(coordinator, /const paymentCard = await acquireTravelportStaysReservationPaymentCard/);
  assert.doesNotMatch(coordinator, /paymentCard:\s*TravelportStaysSensitiveReservationPaymentCard|paymentCard:\s*input\.paymentCard/);
  assert.doesNotMatch(coordinator, /JSON\.stringify\(input|console\.(?:info|warn|error)\(.*input|afterData:[\s\S]{0,300}paymentCard/);

  const tokenIndex = executor.indexOf('const accessToken = await this.#accessToken()');
  const sourceIndex = executor.indexOf('const paymentCard = await acquirePaymentCard()', tokenIndex);
  assert.ok(tokenIndex >= 0 && sourceIndex > tokenIndex);

  assert.match(paymentSource, /acquirePaymentCard\(/);
  assert.match(paymentSource, /assertUuidIdentifier/);
  assert.match(paymentSource, /organizationId:/);
  assert.match(paymentSource, /reservationId:/);
  assert.match(paymentSource, /integrationId:/);
  assert.match(paymentSource, /integrationCredentialVersion:/);
  assert.match(paymentSource, /attemptId:/);
  assert.doesNotMatch(paymentSource, /cardNumber:\s*string|securityCode:\s*string|cardHolderName:\s*string|billingAddress\?:/);
  assert.doesNotMatch(observability, /cardNumber|securityCode|cardHolder|traveler|providerReservationReference|supplierConfirmationReference/i);
  assert.match(integration, /capabilities: Object\.freeze\(\['availability', 'hotel-search', 'pricing'\] as const\)/);
});

test('Travelport reservation identity is shared by create and recovery rather than re-decoded independently', () => {
  const identity = source('src/server/suppliers/travelport-stays-reservation-identity.ts');
  const coordinator = source('src/server/suppliers/travelport-stays-reservation-create-service.ts');
  const recovery = source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');

  assert.match(identity, /export function decodeTravelportStaysPropertyReference/);
  assert.match(identity, /export function normalizeTravelportStaysReservationExpectation/);
  assert.match(coordinator, /normalizeTravelportStaysReservationExpectation/);
  assert.match(recovery, /normalizeTravelportStaysReservationExpectation/);
  assert.doesNotMatch(recovery, /function decodePropertyReference/);
});

test('create coordinator documentation keeps PCI, review acceptance, and capability activation as explicit blockers', () => {
  const document = source('docs/travelport-reservation-create-coordinator.md');
  assert.match(document, /not a card-collection surface/i);
  assert.match(document, /reservation.*remains disabled/i);
  assert.match(document, /provider-request marker/i);
  assert.match(document, /REVIEW_REQUIRED/);
  assert.match(document, /PCI-safe/i);
  assert.match(document, /separately authorized price\/guarantee-change acceptance/i);
  assert.match(document, /OAuth[\s\S]{0,300}(?:before|prior to)[\s\S]{0,300}(?:payment-card source|form-of-payment|PAN|CVV)/i);
});

test('direct create-path documentation reflects the implemented executor and coordinator without enabling reservation', () => {
  for (const path of [
    'docs/supplier-reservation-create-readiness.md',
    'docs/supplier-reservation-submission-authority.md',
    'docs/supplier-reservation-attempt-recovery.md',
    'docs/travelport-stays-integration.md',
    'docs/travelport-stays-create-outcome-classification.md',
  ]) {
    const document = source(path);
    assert.doesNotMatch(document, /future create coordinator|actual single-room create executor/i, path);
    assert.match(document, /reservation.*(?:remains|still|stays).*disabled|does not yet advertise `reservation`|does not yet advertise reservation/i, path);
  }
});
