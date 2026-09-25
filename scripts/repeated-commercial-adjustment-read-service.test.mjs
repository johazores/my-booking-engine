import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authority = readFileSync('src/server/payments/hospitality-issued-adjustment-note-authority-service.ts', 'utf8');
const readService = readFileSync('src/server/payments/hospitality-issued-adjustment-note-read-service.ts', 'utf8');
const chainReadService = readFileSync('src/server/payments/hospitality-commercial-amendment-adjustment-chain-read-service.ts', 'utf8');

test('commercial adjustment reads use one direction-aware chain authority for schema v2-v5 evidence', () => {
  assert.match(authority, /verifyHospitalityCommercialAmendmentAdjustmentRowsInTransaction/);
  assert.doesNotMatch(authority, /verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows/);
  assert.match(authority, /row\.adjustmentType === 'DECREASING'/);
  assert.match(authority, /row\.adjustmentType === 'INCREASING'/);
  assert.match(authority, /createHospitalityIssuedAdjustmentNoteDocument\(row\.documentSnapshot\)/);
  assert.match(chainReadService, /verifyHospitalityCommercialAmendmentAdjustmentRowsInTransaction/);
  assert.match(chainReadService, /loadVerifiedHospitalityCommercialAmendmentAdjustmentChain/);
  assert.match(chainReadService, /transaction: input\.transaction/);
  assert.match(chainReadService, /verified\.priorAdjustments\.map\(\(entry\) => entry\.adjustmentNoteId\)/);
});

test('staff list, accounting export, and detail share the selected-row RepeatableRead authority snapshot', () => {
  const uses = [...readService.matchAll(/validateRowsWithAuthoritiesInTransaction\(transaction, input\.organizationId, (?:rows|\[row\])\)/g)];
  assert.equal(uses.length, 3);
  assert.match(readService, /permission:\s*'booking:read'/);
  assert.match(readService, /permission:\s*'payment:read'/);
  assert.match(readService, /isolationLevel: 'RepeatableRead'/);
  assert.match(authority, /row\.organizationId !== input\.organizationId/);
});

test('legacy cancellation authority binds immutable source and refund identity without redefining mutable provider status', () => {
  const start = authority.indexOf('async function verifyCancellationAuthorities');
  const end = authority.indexOf('async function verifyCancellationAfterAmendmentAuthorities', start);
  assert.ok(start >= 0 && end > start);
  const cancellation = authority.slice(start, end);

  assert.match(authority, /row\.predecessorAdjustmentNoteId !== null/);
  assert.match(authority, /row\.predecessorSourceAdjustmentOrdinal !== null/);
  assert.match(authority, /row\.sourceAdjustmentOrdinal !== 1/);
  assert.match(cancellation, /refund\.kind !== 'REFUND'/);
  assert.doesNotMatch(cancellation, /refund\.status !== 'SUCCEEDED'/);
  assert.match(cancellation, /Current refund status is mutable provider lifecycle truth/);
  assert.match(authority, /hospitalityIssuedInvoiceFingerprint\(sourceSnapshot\)/);
});
