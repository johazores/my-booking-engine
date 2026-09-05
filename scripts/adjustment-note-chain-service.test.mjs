import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(
  new URL('../src/server/payments/hospitality-commercial-amendment-adjustment-chain-service.ts', import.meta.url),
  'utf8',
);

test('chain loader keeps every persistence lookup tenant, booking, and source scoped', () => {
  assert.match(service, /hospitalityIssuedInvoice\.findFirst\([\s\S]*id: input\.sourceInvoiceId[\s\S]*organizationId: input\.organizationId[\s\S]*bookingId: input\.bookingId/);
  assert.match(service, /hospitalityIssuedAdjustmentNote\.findMany\([\s\S]*organizationId: input\.organizationId[\s\S]*bookingId: input\.bookingId[\s\S]*sourceInvoiceId: input\.sourceInvoiceId/);
  assert.match(service, /hospitalityBookingCommercialAmendment\.findMany\([\s\S]*organizationId: input\.organizationId[\s\S]*bookingId: input\.bookingId/);
  assert.match(service, /hospitalityBookingPricingEvidence\.findMany\([\s\S]*organizationId: input\.organizationId[\s\S]*bookingId: input\.bookingId[\s\S]*source: 'COMMERCIAL_AMENDMENT_TARGET'/);
  assert.match(service, /paymentTransaction\.findMany\([\s\S]*organizationId: input\.organizationId[\s\S]*bookingId: input\.bookingId/);
  assert.doesNotMatch(service, /\bdb\./);
});

test('chain loader parses and fingerprints both supported commercial adjustment directions', () => {
  assert.match(service, /row\.adjustmentType === 'DECREASING'/);
  assert.match(service, /parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot/);
  assert.match(service, /hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint/);
  assert.match(service, /row\.adjustmentType === 'INCREASING'/);
  assert.match(service, /parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot/);
  assert.match(service, /hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint/);
});

test('chain settlement is re-proved stepwise from base payment truth plus issued chain amendments', () => {
  assert.match(service, /deriveHospitalityCommercialAmendmentSettlementState/);
  assert.match(service, /chainAmendmentIds = new Set\(amendmentIds\)/);
  assert.match(service, /createdAt: true/);
  assert.match(service, /baseSettlementTransactions = paymentTransactions\.filter\([\s\S]*commercialAmendmentId === null/);
  assert.match(service, /progressiveCommercialAmendmentTransactions/);
  assert.match(service, /settlementTransactionsByAmendment/);
  assert.match(service, /progressiveCommercialAmendmentTransactions\.push\([\s\S]*settlementTransactionsByAmendment\.get\(amendment\.id\)/);
  assert.match(service, /transaction\.createdAt\.getTime\(\) <= row\.issuedAt\.getTime\(\)/);
  assert.match(service, /transactions: settlementTransactionsAtIssue/);
});

test('write-head selection serializes one tenant booking source-invoice chain before verification', () => {
  assert.match(service, /selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite/);
  assert.match(service, /pg_advisory_xact_lock\(hashtextextended\(\$\{chainLockKey\(input\)\}, 0\)\)/);
  assert.match(service, /return loadVerifiedHospitalityCommercialAmendmentAdjustmentChain\(input\);/);
});

test('chain loading is bounded, strict by default, and permits only one terminal cancellation for historical reads', () => {
  assert.match(service, /HOSPITALITY_COMMERCIAL_AMENDMENT_ADJUSTMENT_CHAIN_LIMIT = 5_000/);
  assert.match(service, /take: HOSPITALITY_COMMERCIAL_AMENDMENT_ADJUSTMENT_CHAIN_LIMIT \+ \(input\.allowTerminalCancellation \? 2 : 1\)/);
  assert.match(service, /if \(!input\.allowTerminalCancellation\)[\s\S]*A non-commercial legal adjustment already exists/);
  assert.match(service, /nonCommercial\.length !== 1 \|\| nonCommercial\[0\]!\.adjustmentReason !== 'BOOKING_CANCELLATION'/);
  assert.match(service, /terminal\.predecessorAdjustmentNoteId !== predecessor\.id/);
});
