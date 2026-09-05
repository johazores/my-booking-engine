import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const chain = readFileSync(new URL('src/server/payments/hospitality-commercial-amendment-adjustment-chain-service.ts', root), 'utf8');
const chainRead = readFileSync(new URL('src/server/payments/hospitality-commercial-amendment-adjustment-chain-read-service.ts', root), 'utf8');
const cancellationAuthority = readFileSync(new URL('src/server/payments/hospitality-cancellation-after-amendment-adjustment-authority-service.ts', root), 'utf8');
const sharedAuthority = readFileSync(new URL('src/server/payments/hospitality-issued-adjustment-note-authority-service.ts', root), 'utf8');
const documentDomain = readFileSync(new URL('src/server/payments/hospitality-issued-adjustment-note-document-domain.ts', root), 'utf8');

test('historical commercial reads tolerate only one structurally terminal booking cancellation', () => {
  assert.match(chain, /allowTerminalCancellation\?: boolean/);
  assert.match(chain, /nonCommercial\.length !== 1 \|\| nonCommercial\[0\]!\.adjustmentReason !== 'BOOKING_CANCELLATION'/);
  assert.match(chain, /terminal\.sourceAdjustmentOrdinal !== predecessor\.sourceAdjustmentOrdinal \+ 1/);
  assert.match(chain, /terminal\.predecessorAdjustmentNoteId !== predecessor\.id/);
  assert.match(chainRead, /allowTerminalCancellation: true/);
});

test('write chain remains fail closed because terminal tolerance is never enabled by the locked writer selector', () => {
  assert.match(chain, /if \(!input\.allowTerminalCancellation\)[\s\S]*A non-commercial legal adjustment already exists/);
  assert.match(chain, /selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite[\s\S]*return loadVerifiedHospitalityCommercialAmendmentAdjustmentChain\(input\);/);
});

test('schema-version-6 cancellation authority re-proves predecessor, issue-time settlement, and every frozen refund', () => {
  assert.match(cancellationAuthority, /allowTerminalCancellation: true/);
  assert.match(cancellationAuthority, /deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness/);
  assert.match(cancellationAuthority, /transactionsAtIssue/);
  assert.match(cancellationAuthority, /verifyFrozenRefundAuthorities/);
  assert.match(cancellationAuthority, /sourceInvoice\.documentFingerprint !== snapshot\.sourceInvoiceFingerprint/);
  assert.match(cancellationAuthority, /head\.documentFingerprint !== snapshot\.predecessorAdjustmentDocumentFingerprint/);
  assert.match(cancellationAuthority, /head\.afterPricingFingerprint !== snapshot\.predecessorAfterPricingFingerprint/);
});

test('shared read authority and document projection explicitly dispatch schema-version-6 cancellation evidence', () => {
  assert.match(sharedAuthority, /snapshotVersion === 6/);
  assert.match(sharedAuthority, /verifyHospitalityCancellationAfterAmendmentAdjustmentRows/);
  assert.match(documentDomain, /record\.adjustmentReason === 'BOOKING_CANCELLATION' && record\.schemaVersion === 6/);
  assert.match(documentDomain, /cancellationAfterAmendmentDocument/);
});
