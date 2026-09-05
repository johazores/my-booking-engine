import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const writer = readFileSync(
  new URL('../src/server/payments/hospitality-repeated-commercial-amendment-increasing-adjustment-note-service.ts', import.meta.url),
  'utf8',
);
const product = readFileSync(
  new URL('../src/server/payments/hospitality-commercial-amendment-adjustment-product-service.ts', import.meta.url),
  'utf8',
);

test('repeated increasing writer requires tenant payment management and serializable chain locking', () => {
  assert.match(writer, /permission: 'payment:manage'/);
  assert.match(writer, /selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite/);
  assert.match(writer, /organizationId: input\.organizationId/);
  assert.match(writer, /bookingId: input\.bookingId/);
  assert.match(writer, /sourceInvoiceId: sourceInvoice\.id/);
  assert.match(writer, /isolationLevel: 'Serializable'/);
  assert.match(writer, /attempt < 3/);
  assert.match(writer, /code === 'P2002' \|\| code === 'P2034'/);
});

test('repeated increasing writer re-proves cumulative readiness and cross-direction baseline uniqueness', () => {
  assert.match(writer, /assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness/);
  assert.match(writer, /priorAdjustmentNoteCount: chain\.priorAdjustmentNoteCount/);
  assert.match(writer, /priorAdjustments: chain\.priorAdjustments/);
  assert.match(writer, /readiness\.expectedSourceAdjustmentOrdinal !== chain\.expectedSourceAdjustmentOrdinal/);
  assert.match(writer, /readiness\.predecessorAdjustmentNoteId !== chain\.head\.adjustmentNoteId/);
  assert.match(writer, /direction: \{ in: \['REFUND', 'ADDITIONAL_CHARGE'\] \}/);
  assert.match(writer, /beforePricingFingerprint: amendment\.beforePricingFingerprint/);
  assert.match(writer, /competingBaselineAmendmentCount !== 0/);
});

test('repeated increasing writer persists only schema-version-5 predecessor-bound increasing evidence', () => {
  assert.match(writer, /createHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot/);
  assert.match(writer, /predecessorAdjustment: \{/);
  assert.match(writer, /adjustmentNoteId: chain\.head\.adjustmentNoteId/);
  assert.match(writer, /afterPricingFingerprint: chain\.head\.afterPricingFingerprint/);
  assert.match(writer, /snapshot\.schemaVersion !== 5/);
  assert.match(writer, /predecessorAdjustmentNoteId: chain\.head\.adjustmentNoteId/);
  assert.match(writer, /predecessorSourceAdjustmentOrdinal: chain\.head\.sourceAdjustmentOrdinal/);
  assert.match(writer, /adjustmentType: 'INCREASING'/);
  assert.match(writer, /decreaseSubtotalMinor: 0n/);
  assert.match(writer, /decreaseTaxMinor: 0n/);
  assert.match(writer, /decreaseTotalMinor: 0n/);
  assert.match(writer, /increaseSubtotalMinor: BigInt\(snapshot\.increaseSubtotalMinor\)/);
  assert.match(writer, /increaseTaxMinor: BigInt\(snapshot\.increaseTaxMinor\)/);
  assert.match(writer, /increaseTotalMinor: BigInt\(snapshot\.increaseTotalMinor\)/);
});

test('repeated increasing writer immediately re-verifies the created row through the shared legal chain', () => {
  assert.match(writer, /loadVerifiedHospitalityCommercialAmendmentAdjustmentChain/);
  assert.match(writer, /reloadedChain\.head\?\.adjustmentNoteId !== created\.id/);
  assert.match(writer, /reloadedChain\.head\.adjustmentType !== 'INCREASING'/);
  assert.match(writer, /reloadedChain\.expectedSourceAdjustmentOrdinal !== sourceAdjustmentOrdinal \+ 1/);
  assert.match(writer, /action: 'payment\.adjustment-note\.issued'/);
  assert.match(writer, /increaseTotalMinor: snapshot\.increaseTotalMinor/);
});

test('repeated increasing writer remains product-unreachable until downstream reads and delivery are upgraded', () => {
  assert.doesNotMatch(product, /issueHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNote/);
});
