import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(new URL('../src/server/payments/hospitality-commercial-adjustment-settlement-reconciliation-service.ts', import.meta.url), 'utf8');
const driftDomain = readFileSync(new URL('../src/server/payments/hospitality-tax-document-settlement-drift-domain.ts', import.meta.url), 'utf8');
const reconciliation = readFileSync(new URL('../src/server/payments/hospitality-tax-document-reconciliation-service.ts', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../docs/commercial-adjustment-settlement-reconciliation.md', import.meta.url), 'utf8');

test('commercial settlement reconciliation stays tenant scoped and bounded', () => {
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /adjustmentReason: 'COMMERCIAL_AMENDMENT'/);
  assert.match(service, /take: input\.documentLimit \+ 1/);
  assert.match(service, /COMMERCIAL_SETTLEMENT_TRANSACTION_LIMIT \+ 1/);
  assert.match(service, /bookingId: \{ in: bookingIds \}/);
  assert.match(service, /createdAt: \{ lte: latestIssueTime \}/);
});

test('only fingerprint verified immutable documents can become settlement authorities', () => {
  assert.match(service, /parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot/);
  assert.match(service, /hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint\(snapshot\) !== row\.documentFingerprint/);
  assert.match(service, /parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot/);
  assert.match(service, /hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint\(snapshot\) !== row\.documentFingerprint/);
  assert.match(service, /snapshot\.commercialAmendmentId !== row\.commercialAmendmentId/);
  assert.match(service, /new Date\(snapshot\.issuedAt\)\.getTime\(\) !== row\.issuedAt\.getTime\(\)/);
});

test('current settlement replay is limited to the legal chain and document issue time', () => {
  assert.match(service, /candidate\.sourceAdjustmentOrdinal <= authority\.sourceAdjustmentOrdinal/);
  assert.match(service, /transaction\.createdAt\.getTime\(\) <= authority\.issuedAt\.getTime\(\)/);
  assert.match(service, /transaction\.commercialAmendmentId === null \|\| allowedAmendmentIds\.has\(transaction\.commercialAmendmentId\)/);
  assert.match(service, /deriveHospitalityCommercialAmendmentSettlementState/);
  assert.match(service, /findHospitalityCommercialTaxDocumentSettlementDrift/);
});

test('commercial drift requires exact expected money and ready settlement state', () => {
  assert.match(driftDomain, /settlement\.state !== 'READY_TO_APPLY'/);
  assert.match(driftDomain, /settlement\.remainingAdjustmentMinor !== 0n/);
  assert.match(driftDomain, /settlement\.settledAdjustmentMinor !== settlement\.expectedAdjustmentMinor/);
  assert.match(driftDomain, /settlement\.netSettledMinor !== settlement\.expectedNetSettledMinor/);
});

test('tenant reconciliation includes commercial settlement drift without weakening register validation', () => {
  assert.match(reconciliation, /validateAdjustmentNoteRegister/);
  assert.match(reconciliation, /currentCancellationRefundSettlementDriftFailures/);
  assert.match(reconciliation, /currentHospitalityCommercialAdjustmentSettlementDriftFailures/);
  assert.match(reconciliation, /commercialSettlement\.status === 'DOCUMENT_LIMIT_EXCEEDED'/);
  assert.match(reconciliation, /commercialSettlement\.status === 'TRANSACTION_LIMIT_EXCEEDED'/);
  assert.match(reconciliation, /failures\.push\(\.\.\.commercialSettlement\.failures\)/);
});

test('documentation keeps current reconciliation separate from future historical settlement evidence', () => {
  assert.match(guide, /schema versions 2 through 5/i);
  assert.match(guide, /current-state observability, not a substitute for versioned issue-time settlement evidence/i);
  assert.match(guide, /Existing schema versions are not rewritten in place/i);
});
