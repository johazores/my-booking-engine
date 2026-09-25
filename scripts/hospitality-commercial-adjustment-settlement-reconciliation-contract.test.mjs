import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(new URL('../src/server/payments/hospitality-commercial-adjustment-settlement-reconciliation-service.ts', import.meta.url), 'utf8');
const authorityDomain = readFileSync(new URL('../src/server/payments/hospitality-commercial-settlement-reconciliation-authority-domain.ts', import.meta.url), 'utf8');
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

test('transaction-aware core reuses caller snapshot and standalone wrapper owns one snapshot', () => {
  assert.match(service, /export async function currentHospitalityCommercialAdjustmentSettlementDriftFailuresInTransaction/);
  assert.match(service, /transaction: Prisma\.TransactionClient/);
  assert.match(service, /const transaction = input\.transaction/);
  assert.match(service, /transaction\.hospitalityIssuedAdjustmentNote\.findMany/);
  assert.match(service, /transaction\.hospitalityIssuedInvoice\.findMany/);
  assert.match(service, /transaction\.hospitalityBookingCommercialAmendment\.findMany/);
  assert.match(service, /transaction\.hospitalityBookingPricingEvidence\.findMany/);
  assert.match(service, /transaction\.paymentTransaction\.findMany/);
  assert.match(service, /return db\.\$transaction\(/);
  assert.match(service, /currentHospitalityCommercialAdjustmentSettlementDriftFailuresInTransaction\(\{/);
  assert.match(service, /isolationLevel: 'RepeatableRead'/);
});

test('only fingerprint verified immutable documents can become settlement authorities', () => {
  assert.match(service, /parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot/);
  assert.match(service, /hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint\(snapshot\) !== row\.documentFingerprint/);
  assert.match(service, /parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot/);
  assert.match(service, /hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint\(snapshot\) !== row\.documentFingerprint/);
  assert.match(service, /snapshot\.commercialAmendmentId !== row\.commercialAmendmentId/);
  assert.match(service, /new Date\(snapshot\.issuedAt\)\.getTime\(\) !== row\.issuedAt\.getTime\(\)/);
});

test('source invoice immutable authority is reloaded through the caller transaction before drift classification', () => {
  assert.match(service, /transaction\.hospitalityIssuedInvoice\.findMany/);
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /parseHospitalityIssuedTaxInvoiceSnapshot/);
  assert.match(service, /hospitalityIssuedInvoiceFingerprint\(snapshot\) !== row\.documentFingerprint/);
  assert.match(service, /document\.documentFingerprint !== row\.documentFingerprint/);
  assert.match(service, /sourceInvoiceFingerprint: snapshot\.sourceInvoiceFingerprint/);
  assert.match(service, /issuerFingerprint: snapshot\.issuerFingerprint/);
  assert.match(service, /recipientFingerprint: snapshot\.recipientFingerprint/);
  assert.match(service, /sourceInvoices,/);
});

test('commercial settlement authority is revalidated as one complete source chain', () => {
  assert.match(service, /selectVerifiedHospitalityCommercialSettlementAuthorityGroups/);
  assert.match(service, /authorities: parsedAuthorities/);
  assert.match(authorityDomain, /sourceInvoiceMatchesAuthority/);
  assert.match(authorityDomain, /sourceInvoice\.documentFingerprint === authority\.sourceInvoiceFingerprint/);
  assert.match(authorityDomain, /sourceInvoice\.issuerFingerprint === authority\.issuerFingerprint/);
  assert.match(authorityDomain, /sourceInvoice\.recipientFingerprint === authority\.recipientFingerprint/);
  assert.match(authorityDomain, /sourceInvoice\?\.totalMinor !== authority\.beforeTotalMinor/);
  assert.match(authorityDomain, /sourceInvoice\?\.pricingFingerprint !== authority\.beforePricingFingerprint/);
  assert.match(authorityDomain, /authority\.beforeTotalMinor !== previous\.afterTotalMinor/);
  assert.match(authorityDomain, /authority\.beforePricingFingerprint !== previous\.afterPricingFingerprint/);
  assert.match(authorityDomain, /amendment\.appliedAt\.getTime\(\) === authority\.commercialAmendmentAppliedAt\.getTime\(\)/);
  assert.match(authorityDomain, /amendment\.beforePricingFingerprint === authority\.beforePricingFingerprint/);
  assert.match(authorityDomain, /amendment\.afterPricingFingerprint === authority\.afterPricingFingerprint/);
  assert.match(authorityDomain, /target\.commercialAmendmentId === authority\.commercialAmendmentId/);
  assert.match(authorityDomain, /target\.pricingFingerprint === authority\.afterPricingFingerprint/);
  assert.match(authorityDomain, /target\.totalMinor === authority\.afterTotalMinor/);
  assert.match(authorityDomain, /amendmentIds\.has\(authority\.commercialAmendmentId\)/);
  assert.match(authorityDomain, /targetEvidenceIds\.has\(authority\.targetPricingEvidenceId\)/);
});

test('current settlement replay uses only fully verified group members through document issue time', () => {
  assert.match(service, /const authorityGroups = selectVerifiedHospitalityCommercialSettlementAuthorityGroups/);
  assert.match(service, /const validAuthorities = \[\.\.\.authorityGroups\.values\(\)\]\.flat\(\)/);
  assert.match(service, /candidate\.sourceAdjustmentOrdinal <= authority\.sourceAdjustmentOrdinal/);
  assert.match(service, /item\.createdAt\.getTime\(\) <= authority\.issuedAt\.getTime\(\)/);
  assert.match(service, /item\.commercialAmendmentId === null \|\| allowedAmendmentIds\.has\(item\.commercialAmendmentId\)/);
  assert.match(service, /deriveHospitalityCommercialAmendmentSettlementState/);
  assert.match(service, /findHospitalityCommercialTaxDocumentSettlementDrift/);
});

test('commercial drift requires exact expected money and ready settlement state', () => {
  assert.match(driftDomain, /settlement\.state !== 'READY_TO_APPLY'/);
  assert.match(driftDomain, /settlement\.remainingAdjustmentMinor !== 0n/);
  assert.match(driftDomain, /settlement\.settledAdjustmentMinor !== settlement\.expectedAdjustmentMinor/);
  assert.match(driftDomain, /settlement\.netSettledMinor !== settlement\.expectedNetSettledMinor/);
});

test('tenant reconciliation uses transaction-aware commercial drift without weakening register validation', () => {
  assert.match(reconciliation, /validateAdjustmentNoteRegisterInTransaction/);
  assert.match(reconciliation, /currentCancellationRefundSettlementDriftFailuresInTransaction/);
  assert.match(reconciliation, /currentHospitalityCommercialAdjustmentSettlementDriftFailuresInTransaction/);
  assert.match(reconciliation, /transaction,\s+organizationId: input\.organizationId/);
  assert.match(reconciliation, /commercialSettlement\.status === 'DOCUMENT_LIMIT_EXCEEDED'/);
  assert.match(reconciliation, /commercialSettlement\.status === 'TRANSACTION_LIMIT_EXCEEDED'/);
  assert.match(reconciliation, /failures\.push\(\.\.\.commercialSettlement\.failures\)/);
});

test('documentation separates current drift from frozen historical authority and legacy evidence', () => {
  assert.match(guide, /source tax invoice is reloaded/i);
  assert.match(guide, /exact currency and monetary continuity/i);
  assert.match(guide, /entire source-invoice commercial chain/i);
  assert.match(guide, /excluded from settlement-drift classification/i);
  assert.match(guide, /current lifecycle status/i);
  assert.match(guide, /Newly issued schema-version-2-through-5 commercial adjustment notes freeze their provider-neutral issue-time payment ledger/i);
  assert.match(guide, /leading legacy prefix followed by a contiguous frozen-evidence suffix/i);
  assert.match(guide, /same caller-owned PostgreSQL `RepeatableRead` snapshot/i);
  assert.match(guide, /standalone .* entry point remains available/i);
  assert.doesNotMatch(guide, /A future schema version must freeze/i);
  assert.doesNotMatch(guide, /still derive their historical settlement proof from persisted transactions/i);
});
