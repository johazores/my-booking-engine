import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const staff = readFileSync(new URL('../src/server/payments/hospitality-issued-adjustment-note-read-service.ts', import.meta.url), 'utf8');
const publicService = readFileSync(new URL('../src/server/payments/public-issued-tax-invoice-service.ts', import.meta.url), 'utf8');
const register = readFileSync(new URL('../app/invoices/adjustments/page.tsx', import.meta.url), 'utf8');
const detail = readFileSync(new URL('../app/invoices/adjustments/[document-number]/page.tsx', import.meta.url), 'utf8');
const publicUi = readFileSync(new URL('../app/book/[organization-slug]/public-booking-tax-invoices.tsx', import.meta.url), 'utf8');

test('staff adjustment reads classify and independently verify increasing authority', () => {
  assert.match(staff, /adjustmentType: string;/);
  assert.match(staff, /increaseSubtotalMinor: bigint;/);
  assert.match(staff, /parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot/);
  assert.match(staff, /kind: 'COMMERCIAL_AMENDMENT_INCREASING'/);
  assert.match(staff, /verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows/);
  assert.match(staff, /offset \+= HOSPITALITY_INCREASING_ADJUSTMENT_READ_BATCH_LIMIT/);
  assert.match(staff, /row\.adjustmentType !== 'INCREASING'/);
  assert.match(staff, /!hasZeroDecrease\(row\)/);
});

test('staff register and accounting projections keep increase and decrease separate', () => {
  assert.match(staff, /adjustmentType: item\.document\.adjustmentType/);
  assert.match(staff, /increaseTotalMinor: BigInt\(item\.document\.increaseTotalMinor\)/);
  assert.match(staff, /adjustmentType: 'Increasing adjustment' as const/);
  assert.match(staff, /decreaseTotalMinor: 0n as const/);
  assert.match(staff, /increaseGstMinor: BigInt\(document\.increaseGstMinor\)/);
  assert.match(register, /note\.adjustmentType === 'Increasing adjustment'/);
  assert.match(register, /Increase \$\{money\(note\.increaseTotalMinor/);
  assert.match(register, />Effect</);
});

test('staff detail renders direction-correct legal effect and retains source navigation', () => {
  assert.match(detail, /const increasingAdjustment = document\.adjustmentType === 'Increasing adjustment'/);
  assert.match(detail, /document\.increaseSubtotalMinor/);
  assert.match(detail, /document\.increaseGstMinor/);
  assert.match(detail, /document\.increaseTotalMinor/);
  assert.match(detail, /This increasing adjustment records the applied commercial booking amendment/);
  assert.match(detail, /sourceTaxInvoiceNumber/);
});

test('public capability read remains tenant and booking scoped while admitting verified increasing notes', () => {
  assert.match(publicService, /expectedOrganizationId: branding\.id/);
  assert.match(publicService, /organizationId_bookingId: \{ organizationId: branding\.id, bookingId: capability\.bookingId \}/);
  assert.match(publicService, /organizationId: branding\.id, bookingId: capability\.bookingId/);
  assert.match(publicService, /parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot/);
  assert.match(publicService, /verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows/);
  assert.match(publicService, /kind: 'COMMERCIAL_AMENDMENT_INCREASING'/);
  assert.match(publicService, /increaseTotalMinor: document\.increaseTotalMinor/);
});

test('public history, print and PDF payload are direction aware', () => {
  assert.match(publicUi, /'Decreasing adjustment' \| 'Increasing adjustment'/);
  assert.match(publicUi, /increaseSubtotalMinor: string;/);
  assert.match(publicUi, /const increasing = note\.adjustmentType === 'Increasing adjustment'/);
  assert.match(publicUi, /\{increasing \? '\+' : '−'\}/);
  assert.match(publicUi, /Total \{effectLabel\} incl\. GST/);
  assert.match(publicUi, /adjustmentNoteStatement\(note\)/);
});
