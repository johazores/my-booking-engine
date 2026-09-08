import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Travelport write decisions keep review and sell uncertainty fail-closed', () => {
  const classifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');
  const mapper = source('src/server/suppliers/travelport-stays-reservation-submission-outcome.ts');
  assert.match(classifier, /GUARANTEE_CHANGE_SOURCE_CODES = new Set\(\['13016', '13017', '13018'\]\)/);
  assert.match(classifier, /PRICE_CHANGE_SOURCE_CODE = '13020'/);
  assert.match(classifier, /SYNC_REQUIRED_SOURCE_CODE = '13034'/);
  assert.match(classifier, /status: 'REVIEW_REQUIRED'/);
  assert.match(classifier, /'PRICE_AND_GUARANTEE_CHANGED'/);
  assert.match(classifier, /status: 'AMBIGUOUS'[\s\S]*?failureCode: 'TRAVELPORT_SYNC_REQUIRED'/);
  assert.match(classifier, /failureCode: 'INVALID_RESPONSE'/);
  assert.match(mapper, /TRAVELPORT_SELL_UNCERTAIN/);
  assert.match(mapper, /outcome\.failureCode === 'TRAVELPORT_SYNC_REQUIRED'/);
  assert.match(mapper, /!outcome\.supplierConfirmationReference/);
  assert.match(mapper, /!outcome\.providerRecoveryReference/);
});

test('definitive no-sell failures require reviewed validation-category source codes', () => {
  const classifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');
  assert.match(classifier, /DEFINITIVE_NO_SELL_VALIDATION_SOURCE_CODES/);
  assert.match(
    classifier,
    /RETRYABLE_EPHEMERAL_PAYMENT_VALIDATION_SOURCE_CODES = new Set\(\[[\s\S]*?'1537'[\s\S]*?'1547'[\s\S]*?'13050'[\s\S]*?'13054'[\s\S]*?'13078'[\s\S]*?'13083'[\s\S]*?\]\)/,
  );
  assert.match(classifier, /errors\.errors\.every\(\(error\) => error\.category === 'VALIDATION'\)/);
  assert.match(classifier, /status: 'FAILED'/);
  assert.match(classifier, /failureCode: `TRAVELPORT_VALIDATION_\$\{sourceCode\}`/);
  assert.match(classifier, /retryable: RETRYABLE_EPHEMERAL_PAYMENT_VALIDATION_SOURCE_CODES\.has\(sourceCode\)/);
});

test('provider error and warning envelopes are bounded and cannot be ignored to confirm a write', () => {
  const classifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');
  assert.match(classifier, /type ProviderErrorInspection/);
  assert.match(classifier, /present: boolean/);
  assert.match(classifier, /errors\.length > MAX_ERRORS/);
  assert.match(classifier, /warningValues\.length > MAX_WARNINGS/);
  assert.match(classifier, /if \(!errors\.valid \|\| !warnings\.valid\) return invalidResponse\(providerCorrelationId\)/);
  assert.match(classifier, /if \(errors\.present\)[\s\S]*?return invalidResponse\(providerCorrelationId\)/);
  assert.match(classifier, /validExpectedReservation\(expected\)/);
});

test('supplier confirmation is retained only as bounded Sync evidence and raw provider messages are excluded', () => {
  const classifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');
  assert.match(classifier, /locatorType === 'Confirmation Number'/);
  assert.match(classifier, /productMatchesExpectedReservation/);
  assert.match(classifier, /supplierConfirmationReference: reservationMatches \? locators\.supplier : null/);
  assert.doesNotMatch(classifier, /return[^;]*Message|providerMessage|rawMessage/);
});

test('Travelport review outcomes use a dedicated durable state instead of generic failed retry semantics', () => {
  const mapper = source('src/server/suppliers/travelport-stays-reservation-submission-outcome.ts');
  const coordinator = source('src/server/suppliers/travelport-stays-reservation-create-service.ts');
  const reviewService = source('src/server/suppliers/hospitality-supplier-reservation-review-service.ts');
  const schema = source('prisma/hospitality-supplier-reservations.prisma');

  assert.match(coordinator, /createOutcome\.status === 'REVIEW_REQUIRED'/);
  assert.match(coordinator, /settleHospitalitySupplierReservationReviewRequired/);
  assert.match(coordinator, /SUPPLIER_PRICE_CHANGED/);
  assert.match(coordinator, /SUPPLIER_GUARANTEE_CHANGED/);
  assert.match(coordinator, /SUPPLIER_PRICE_AND_GUARANTEE_CHANGED/);
  assert.match(reviewService, /status: 'REVIEW_REQUIRED'/);
  assert.match(reviewService, /providerRequestStartedAt/);
  assert.match(reviewService, /lastFailureRetryable: null/);
  assert.match(reviewService, /supplier\.reservation-review-required/);
  assert.match(schema, /enum HospitalitySupplierReservationOperationStatus\s*\{[\s\S]*REVIEW_REQUIRED/);
  assert.match(schema, /enum HospitalitySupplierReservationAttemptStatus\s*\{[\s\S]*REVIEW_REQUIRED/);
  assert.match(mapper, /dedicated durable review settlement path/);
  assert.doesNotMatch(mapper, /acceptPriceChangeInd|acceptGuaranteeChangeInd/);
});

test('documentation keeps capability disabled and explains the narrow definitive-failure boundary', () => {
  const doc = source('docs/travelport-stays-create-outcome-classification.md');
  assert.match(doc, /does not collect card data/i);
  assert.match(doc, /does not.*enable the `reservation` capability/i);
  assert.match(doc, /definitive no-sell validation failures/i);
  assert.match(doc, /category=VALIDATION/i);
  for (const code of ['1537', '1547', '13050', '13054', '13078', '13083']) assert.match(doc, new RegExp(code));
  assert.match(doc, /unknown codes.*remain `AMBIGUOUS \/ INVALID_RESPONSE`/i);
  assert.match(doc, /dedicated `REVIEW_REQUIRED`/i);
  assert.match(doc, /PCI-safe FormOfPayment/i);
  assert.match(doc, /one-time reviewed second-Create path is implemented separately/i);
  assert.match(doc, /TRAVELPORT_SELL_UNCERTAIN/);
});
