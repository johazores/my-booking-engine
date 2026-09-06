import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Travelport write decisions fail closed and require explicit review for documented sell changes', () => {
  const classifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');
  assert.match(classifier, /GUARANTEE_CHANGE_SOURCE_CODES = new Set\(\['13016', '13017', '13018'\]\)/);
  assert.match(classifier, /PRICE_CHANGE_SOURCE_CODE = '13020'/);
  assert.match(classifier, /SYNC_REQUIRED_SOURCE_CODE = '13034'/);
  assert.match(classifier, /status: 'REVIEW_REQUIRED'/);
  assert.match(classifier, /'PRICE_AND_GUARANTEE_CHANGED'/);
  assert.match(classifier, /'GUARANTEE_CHANGED'/);
  assert.match(classifier, /'PRICE_CHANGED'/);
  assert.match(classifier, /status: 'AMBIGUOUS'[\s\S]*?failureCode: 'TRAVELPORT_SYNC_REQUIRED'/);
  assert.match(classifier, /failureCode: 'INVALID_RESPONSE'/);
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

test('supplier confirmation is retained only as bounded sync evidence and raw provider messages are excluded', () => {
  const classifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');
  assert.match(classifier, /locatorType === 'Confirmation Number'/);
  assert.match(classifier, /matchesExpectedReservation/);
  assert.match(classifier, /supplierConfirmationReference: reservationMatches \? locators\.supplier : null/);
  assert.doesNotMatch(classifier, /return[^;]*Message|providerMessage|rawMessage/);
});

test('Travelport review-required decisions map into the durable ledger without creating an automatic retry path', () => {
  const mapper = source('src/server/suppliers/travelport-stays-reservation-submission-outcome.ts');
  const service = source('src/server/suppliers/hospitality-supplier-reservation-service.ts');

  assert.match(mapper, /HospitalitySupplierReservationSubmissionOutcome/);
  assert.match(mapper, /SUPPLIER_PRICE_CHANGED/);
  assert.match(mapper, /SUPPLIER_GUARANTEE_CHANGED/);
  assert.match(mapper, /SUPPLIER_PRICE_AND_GUARANTEE_CHANGED/);
  assert.match(mapper, /status: 'FAILED'/);
  assert.match(mapper, /retryable: false/);
  assert.match(mapper, /status: 'AMBIGUOUS'/);
  assert.match(mapper, /supplierConfirmationReference: outcome\.supplierConfirmationReference/);
  assert.match(service, /status: 'FAILED'[\s\S]*?failureCode: unknown[\s\S]*?retryable: boolean/);
  assert.doesNotMatch(mapper, /acceptPriceChangeInd|acceptGuaranteeChangeInd/);
});

test('documentation keeps capability disabled and identifies the remaining PCI-safe create boundary', () => {
  const doc = source('docs/travelport-stays-create-outcome-classification.md');
  assert.match(doc, /does not send Create Reservation/i);
  assert.match(doc, /does not.*enable the `reservation` capability/i);
  assert.match(doc, /PCI-safe form-of-payment strategy/i);
  assert.match(doc, /must not turn an unknown 4xx\/5xx or malformed 2xx into a blind create retry/i);
  assert.match(doc, /error envelope.*cannot be treated as a successful sell/i);
  assert.match(doc, /malformed or oversized warning/i);
  assert.match(doc, /non-retryable durable `FAILED` settlement/i);
  assert.match(doc, /does not yet implement that acceptance workflow/i);
});
