import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authority = readFileSync(new URL('../src/server/payments/hospitality-issued-adjustment-note-authority-service.ts', import.meta.url), 'utf8');
const staff = readFileSync(new URL('../src/server/payments/hospitality-issued-adjustment-note-read-service.ts', import.meta.url), 'utf8');
const publicService = readFileSync(new URL('../src/server/payments/public-issued-tax-invoice-service.ts', import.meta.url), 'utf8');

test('staff and public projections no longer depend on first-increasing-only post-issuance verification', () => {
  assert.match(staff, /validateHospitalityIssuedAdjustmentNoteRows/);
  assert.match(publicService, /validateHospitalityIssuedAdjustmentNoteRows/);
  assert.doesNotMatch(staff, /hospitality-commercial-amendment-increasing-adjustment-read-service/);
  assert.doesNotMatch(publicService, /hospitality-commercial-amendment-increasing-adjustment-read-service/);
  assert.match(authority, /verifyHospitalityCommercialAmendmentAdjustmentRows/);
});

test('shared projection preserves mutually exclusive increasing and decreasing legal effects', () => {
  assert.match(authority, /row\.adjustmentType === 'DECREASING'/);
  assert.match(authority, /!zeroIncrease\(row\)/);
  assert.match(authority, /row\.adjustmentType === 'INCREASING'/);
  assert.match(authority, /!zeroDecrease\(row\)/);
  assert.match(staff, /adjustmentType: 'Increasing adjustment' as const/);
  assert.match(staff, /decreaseTotalMinor: 0n as const/);
  assert.match(staff, /increaseGstMinor: BigInt\(document\.increaseGstMinor\)/);
});

test('public projection remains direction aware without exposing server authority', () => {
  assert.match(publicService, /adjustmentType: document\.adjustmentType/);
  assert.match(publicService, /increaseTotalMinor: document\.increaseTotalMinor/);
  assert.match(publicService, /decreaseTotalMinor: document\.decreaseTotalMinor/);
  assert.doesNotMatch(publicService, /predecessorAdjustmentNoteId: document/);
});
