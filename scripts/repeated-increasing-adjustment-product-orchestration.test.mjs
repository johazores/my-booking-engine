import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const product = readFileSync(
  new URL('../src/server/payments/hospitality-commercial-amendment-adjustment-product-service.ts', import.meta.url),
  'utf8',
);
const repeatedAvailability = readFileSync(
  new URL('../src/server/payments/hospitality-repeated-commercial-amendment-increasing-adjustment-availability-service.ts', import.meta.url),
  'utf8',
);
const action = readFileSync(
  new URL('../src/components/commercial-amendment-adjustment-note-action.tsx', import.meta.url),
  'utf8',
);

test('product availability verifies existing commercial history before deriving a next action', () => {
  assert.match(product, /loadVerifiedHospitalityCommercialAmendmentAdjustmentChain/);
  assert.match(product, /organizationId: input\.organizationId/);
  assert.match(product, /bookingId: input\.bookingId/);
  assert.match(product, /adjustmentReason: \{ not: 'COMMERCIAL_AMENDMENT' \}/);
  assert.match(product, /commercialCount === 0/);
  assert.match(product, /chain\.priorAdjustmentNoteCount !== commercialCount/);
  assert.match(product, /containsIncreasing: increasingCount > 0/);
});

test('repeated increasing availability selects exactly one applied amendment on the verified chain-head baseline', () => {
  assert.match(repeatedAvailability, /loadVerifiedHospitalityCommercialAmendmentAdjustmentChain/);
  assert.match(repeatedAvailability, /chain\.priorAdjustmentNoteCount < 1 \|\| !chain\.head/);
  assert.match(repeatedAvailability, /predecessor\.adjustmentNoteId !== chain\.head\.adjustmentNoteId/);
  assert.match(repeatedAvailability, /direction: \{ in: \['REFUND', 'ADDITIONAL_CHARGE'\] \}/);
  assert.match(repeatedAvailability, /beforeTotalMinor: predecessor\.after\.totalMinor/);
  assert.match(repeatedAvailability, /beforePricingFingerprint: predecessor\.after\.pricingFingerprint/);
  assert.match(repeatedAvailability, /appliedAt: \{ gte: chain\.head\.issuedAt \}/);
  assert.match(repeatedAvailability, /candidates\.length !== 1/);
  assert.match(repeatedAvailability, /amendment\.direction !== 'ADDITIONAL_CHARGE'/);
});

test('repeated increasing availability re-proves immutable target pricing, settlement, cumulative readiness and predecessor agreement', () => {
  assert.match(repeatedAvailability, /parseHospitalityBookingPricingEvidenceBreakdown/);
  assert.match(repeatedAvailability, /deriveHospitalityCommercialAmendmentSettlementState/);
  assert.match(repeatedAvailability, /assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness/);
  assert.match(repeatedAvailability, /priorAdjustmentNoteCount: chain\.priorAdjustmentNoteCount/);
  assert.match(repeatedAvailability, /priorAdjustments: chain\.priorAdjustments/);
  assert.match(repeatedAvailability, /readiness\.expectedSourceAdjustmentOrdinal !== chain\.expectedSourceAdjustmentOrdinal/);
  assert.match(repeatedAvailability, /readiness\.predecessorAdjustmentNoteId !== chain\.head\.adjustmentNoteId/);
  assert.match(repeatedAvailability, /readiness\.predecessorDocumentFingerprint !== chain\.head\.documentFingerprint/);
  assert.match(repeatedAvailability, /isolationLevel: 'Serializable'/);
});

test('product orchestration preserves decreasing priority but exposes repeated increasing through server-derived ordinal only', () => {
  assert.match(product, /getHospitalityNextDecreasingCommercialAmendmentAdjustmentNoteAvailability/);
  assert.match(product, /getHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNoteAvailability/);
  assert.match(product, /sourceState\.containsIncreasing && sourceState\.headAdjustmentType === 'DECREASING'/);
  assert.match(product, /adjustmentType: 'INCREASING' as const/);
  assert.match(product, /availability\.sourceAdjustmentOrdinal > 1/);
  assert.match(product, /issueHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNote/);
  assert.doesNotMatch(product, /input\.adjustmentType/);
  assert.doesNotMatch(product, /input\.sourceAdjustmentOrdinal/);
  assert.doesNotMatch(product, /input\.predecessorAdjustmentNoteId/);
});

test('exact issuance retry returns only an adjustment already proven inside the complete tenant/source legal chain', () => {
  assert.match(product, /commercialAmendmentId: input\.commercialAmendmentId/);
  assert.match(product, /existing\.bookingId !== input\.bookingId/);
  assert.match(product, /existing\.sourceInvoiceId !== sourceInvoice\.id/);
  assert.match(product, /chain\.priorAdjustments\.find/);
  assert.match(product, /entry\.adjustmentNoteId === existing\.id/);
  assert.match(product, /verifiedExisting\.sourceAdjustmentOrdinal !== existing\.sourceAdjustmentOrdinal/);
  assert.match(product, /if \(existing\) return existing;/);
});


test('tax-invoice action treats repeated increasing ordinal as display state and keeps legal authority out of the request body', () => {
  assert.match(action, /const repeated = sourceAdjustmentOrdinal > 1/);
  assert.match(action, /Issue next increase adjustment note/);
  assert.match(action, /This will become adjustment \{sourceAdjustmentOrdinal\}/);
  assert.match(action, /body: JSON\.stringify\(\{ sourceInvoiceDocumentNumber \}\)/);
  assert.doesNotMatch(action, /JSON\.stringify\(\{[^}]*adjustmentType/);
  assert.doesNotMatch(action, /JSON\.stringify\(\{[^}]*sourceAdjustmentOrdinal/);
  assert.doesNotMatch(action, /JSON\.stringify\(\{[^}]*predecessor/);
});
