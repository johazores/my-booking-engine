import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Travelport create coordinator uses fresh authority, exact current integration, durable marker, and ledger settlement in order', () => {
  const coordinator = source('src/server/suppliers/travelport-stays-reservation-create-service.ts');
  const review = coordinator.indexOf('await reviewAndClaimHospitalitySupplierReservationSubmission');
  const reload = coordinator.indexOf('await loadTravelportStaysIntegration', review);
  const exactMatch = coordinator.indexOf('assertExecutionIntegrationStillMatches', reload);
  const providerCall = coordinator.indexOf('await execution.reservationCreateExecutor.createReservation', exactMatch);
  const marker = coordinator.indexOf('await markHospitalitySupplierReservationProviderRequestStarted', providerCall);
  const map = coordinator.indexOf('travelportStaysCreateOutcomeToSubmissionOutcome', marker);
  const settle = coordinator.indexOf('settleHospitalitySupplierReservationSubmission', map);

  assert.ok(review >= 0 && reload > review && exactMatch > reload && providerCall > exactMatch && marker > providerCall && map > marker && settle > map);
  assert.match(coordinator, /requestCorrelationId: claim\.attempt\.id/);
  assert.match(coordinator, /attemptId: claim\.attempt\.id/);
  assert.match(coordinator, /integration\.credentialVersion !== reservation\.integrationCredentialVersion/);
  assert.match(coordinator, /!integration\.capabilities\.includes\('reservation'\)/);
});

test('pre-provider failures are retry-safe while any post-marker unexpected failure is ambiguous', () => {
  const coordinator = source('src/server/suppliers/travelport-stays-reservation-create-service.ts');
  assert.match(coordinator, /if \(!providerRequestStarted\)[\s\S]*?settlePreProviderFailure/);
  assert.match(coordinator, /status: 'FAILED',[\s\S]*?retryable: true/);
  assert.match(coordinator, /providerRequestStarted = true/);
  assert.match(coordinator, /status: 'AMBIGUOUS',[\s\S]*?failureCode: 'INVALID_RESPONSE'/);
  assert.match(coordinator, /observationState\.current\?\.finish\('AMBIGUOUS'\)/);
});

test('sensitive form of payment stays an ephemeral adapter argument and never enters logs or durable metadata', () => {
  const coordinator = source('src/server/suppliers/travelport-stays-reservation-create-service.ts');
  const observability = source('src/server/suppliers/travelport-stays-reservation-create-observability.ts');
  const integration = source('src/server/suppliers/travelport-stays-provider.ts');

  assert.match(coordinator, /paymentCard: TravelportStaysSensitiveReservationPaymentCard/);
  assert.match(coordinator, /paymentCard: input\.paymentCard/);
  assert.doesNotMatch(coordinator, /JSON\.stringify\(input|console\.(?:info|warn|error)\(.*input|afterData:[\s\S]{0,300}paymentCard/);
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

test('create coordinator documentation keeps PCI and capability activation as explicit blockers', () => {
  const document = source('docs/travelport-reservation-create-coordinator.md');
  assert.match(document, /not a card-collection surface/i);
  assert.match(document, /reservation.*remains disabled/i);
  assert.match(document, /provider-request marker/i);
  assert.match(document, /ambiguous/i);
  assert.match(document, /PCI-safe/i);
});
