import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readService = readFileSync('src/server/payments/hospitality-issued-adjustment-note-read-service.ts', 'utf8');
const chainReadService = readFileSync('src/server/payments/hospitality-commercial-amendment-adjustment-chain-read-service.ts', 'utf8');

test('commercial adjustment row projection accepts schema v3 only with matching predecessor material authority', () => {
  assert.match(readService, /snapshot\.schemaVersion === 2/);
  assert.match(readService, /row\.sourceAdjustmentOrdinal >= 2/);
  assert.match(readService, /row\.predecessorAdjustmentNoteId === snapshot\.predecessorAdjustmentNoteId/);
  assert.match(readService, /row\.predecessorSourceAdjustmentOrdinal === row\.sourceAdjustmentOrdinal - 1/);
  assert.match(readService, /snapshot\.sourceAdjustmentOrdinal !== String\(row\.sourceAdjustmentOrdinal\)/);
});

test('staff commercial reads verify every selected row through the complete persisted source chain', () => {
  assert.match(readService, /verifyHospitalityCommercialAmendmentAdjustmentRows/);
  assert.match(readService, /await verifyCommercialAuthority\(organizationId, commercialItems\)/);
  assert.match(chainReadService, /loadVerifiedHospitalityCommercialAmendmentAdjustmentChain/);
  assert.match(chainReadService, /verified\.priorAdjustments\.map\(\(entry\) => entry\.adjustmentNoteId\)/);
  assert.match(chainReadService, /if \(!verifiedIds\.has\(row\.id\)\)/);
});

test('tenant-scoped staff list, accounting export, and detail all pass through shared authority validation', () => {
  const uses = [...readService.matchAll(/validateRowsWithAuthorities\(input\.organizationId, (?:rows|\[row\])\)/g)];
  assert.equal(uses.length, 3);
  assert.match(readService, /permission:\s*'booking:read'/);
  assert.match(readService, /permission:\s*'payment:read'/);
});

test('cancellation authority stays ordinal one and predecessor-free', () => {
  assert.match(readService, /row\.predecessorAdjustmentNoteId !== null/);
  assert.match(readService, /row\.predecessorSourceAdjustmentOrdinal !== null/);
  assert.match(readService, /row\.sourceAdjustmentOrdinal !== 1/);
});
