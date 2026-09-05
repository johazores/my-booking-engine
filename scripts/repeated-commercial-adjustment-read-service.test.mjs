import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authority = readFileSync('src/server/payments/hospitality-issued-adjustment-note-authority-service.ts', 'utf8');
const readService = readFileSync('src/server/payments/hospitality-issued-adjustment-note-read-service.ts', 'utf8');
const chainReadService = readFileSync('src/server/payments/hospitality-commercial-amendment-adjustment-chain-read-service.ts', 'utf8');

test('commercial adjustment reads use one direction-aware chain authority for schema v2-v5 evidence', () => {
  assert.match(authority, /verifyHospitalityCommercialAmendmentAdjustmentRows/);
  assert.doesNotMatch(authority, /verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows/);
  assert.match(authority, /row\.adjustmentType === 'DECREASING'/);
  assert.match(authority, /row\.adjustmentType === 'INCREASING'/);
  assert.match(authority, /createHospitalityIssuedAdjustmentNoteDocument\(row\.documentSnapshot\)/);
  assert.match(chainReadService, /loadVerifiedHospitalityCommercialAmendmentAdjustmentChain/);
  assert.match(chainReadService, /verified\.priorAdjustments\.map\(\(entry\) => entry\.adjustmentNoteId\)/);
});

test('staff list, accounting export, and detail all pass through the shared tenant-scoped authority', () => {
  const uses = [...readService.matchAll(/validateRowsWithAuthorities\(input\.organizationId, (?:rows|\[row\])\)/g)];
  assert.equal(uses.length, 3);
  assert.match(readService, /permission:\s*'booking:read'/);
  assert.match(readService, /permission:\s*'payment:read'/);
  assert.match(authority, /row\.organizationId !== input\.organizationId/);
});

test('cancellation remains predecessor-free and independently binds its source invoice and successful refund', () => {
  assert.match(authority, /row\.predecessorAdjustmentNoteId !== null/);
  assert.match(authority, /row\.predecessorSourceAdjustmentOrdinal !== null/);
  assert.match(authority, /row\.sourceAdjustmentOrdinal !== 1/);
  assert.match(authority, /refund\.kind !== 'REFUND'/);
  assert.match(authority, /refund\.status !== 'SUCCEEDED'/);
  assert.match(authority, /hospitalityIssuedInvoiceFingerprint\(sourceSnapshot\)/);
});
