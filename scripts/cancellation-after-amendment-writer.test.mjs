import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const writer = readFileSync(new URL('../src/server/payments/hospitality-cancellation-after-amendment-adjustment-note-service.ts', import.meta.url), 'utf8');
const authority = readFileSync(new URL('../src/server/payments/hospitality-cancellation-after-amendment-adjustment-authority-service.ts', import.meta.url), 'utf8');

test('writer requires tenant payment management and the serialized verified source chain', () => {
  assert.match(writer, /permission: 'payment:manage'/);
  assert.match(writer, /selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite/);
  assert.match(writer, /isolationLevel: 'Serializable'/);
  assert.match(writer, /organizationId: input\.organizationId/);
  assert.match(writer, /bookingId: input\.bookingId/);
});

test('writer derives legal money, predecessor, refunds, numbering, and issue time server-side', () => {
  assert.match(writer, /deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness/);
  assert.match(writer, /sourceAdjustmentOrdinal: readiness\.sourceAdjustmentOrdinal/);
  assert.match(writer, /predecessorAdjustmentNoteId: readiness\.predecessorAdjustmentNoteId/);
  assert.match(writer, /refundAuthorities: readiness\.refundAuthorities/);
  assert.match(writer, /formatAustralianAdjustmentNoteDocumentNumber\(sequenceValue\)/);
  assert.match(writer, /const issuedAt = new Date\(\)/);
  assert.doesNotMatch(writer, /input\.refundTransactionId/);
});

test('writer persists schema-version-6 terminal authority and immediately re-verifies it in the same transaction', () => {
  assert.match(writer, /createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot/);
  assert.match(writer, /adjustmentType: 'DECREASING'/);
  assert.match(writer, /adjustmentReason: 'BOOKING_CANCELLATION'/);
  assert.match(writer, /predecessorSourceAdjustmentOrdinal: readiness\.predecessorSourceAdjustmentOrdinal/);
  assert.match(writer, /verifyHospitalityCancellationAfterAmendmentAdjustmentRowInTransaction/);
  assert.match(authority, /export async function verifyHospitalityCancellationAfterAmendmentAdjustmentRowInTransaction/);
});

test('writer retries serializable or uniqueness races and returns only independently verified idempotent evidence', () => {
  assert.match(writer, /code === 'P2002' \|\| code === 'P2034'/);
  assert.match(writer, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(writer, /if \(existingCancellation\)[\s\S]*verifyHospitalityCancellationAfterAmendmentAdjustmentRowInTransaction/);
  assert.match(writer, /parseHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot/);
});

test('writer emits issuance audit without exposing refund identifiers in audit payload', () => {
  assert.match(writer, /action: 'payment\.adjustment-note\.issued'/);
  assert.match(writer, /refundAuthorityCount: readiness\.refundAuthorities\.length/);
  assert.doesNotMatch(writer, /afterData:\s*\{[\s\S]*refundTransactionId/);
});
