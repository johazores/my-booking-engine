import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readService = readFileSync(new URL('../src/server/payments/hospitality-commercial-amendment-increasing-adjustment-read-service.ts', import.meta.url), 'utf8');
const documentDomain = readFileSync(new URL('../src/server/payments/hospitality-issued-adjustment-note-document-domain.ts', import.meta.url), 'utf8');
const pdfDomain = readFileSync(new URL('../src/server/payments/hospitality-adjustment-note-pdf-domain.ts', import.meta.url), 'utf8');
const accountingDomain = readFileSync(new URL('../src/server/payments/hospitality-adjustment-note-accounting-export-domain.ts', import.meta.url), 'utf8');

test('increasing read authority reloads only tenant-owned first-increasing legal rows', () => {
  assert.match(readService, /organizationId: input\.organizationId/);
  assert.match(readService, /adjustmentType: 'INCREASING'/);
  assert.match(readService, /adjustmentReason: 'COMMERCIAL_AMENDMENT'/);
  assert.match(readService, /sourceAdjustmentOrdinal !== 1/);
  assert.match(readService, /decreaseSubtotalMinor !== 0n/);
  assert.match(readService, /hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint/);
});

test('read authority independently re-proves source invoice, unique target pricing, settlement and sole source authority', () => {
  assert.match(readService, /parseHospitalityIssuedTaxInvoiceSnapshot/);
  assert.match(readService, /parseHospitalityBookingPricingEvidenceBreakdown/);
  assert.match(readService, /deriveHospitalityCommercialAmendmentSettlementState/);
  assert.match(readService, /assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness/);
  assert.match(readService, /sourceAdjustmentIds\.length !== 1/);
  assert.match(readService, /sourceAdjustmentIds\[0\] !== item\.row\.id/);
  assert.match(readService, /commercialAmendmentId: \{ in: amendmentIds \}/);
  assert.match(readService, /targetRows\.length === 1/);
  assert.match(readService, /baselineCompetitors\.length !== 1/);
});

test('read authority is bounded and returns no payment/provider/customer projection data', () => {
  assert.match(readService, /HOSPITALITY_INCREASING_ADJUSTMENT_READ_BATCH_LIMIT = 100/);
  const resultStart = readService.indexOf('return Object.freeze(validatedRows.map');
  const result = readService.slice(resultStart);
  assert.doesNotMatch(result, /providerReference:/);
  assert.doesNotMatch(result, /sourceProviderReference:/);
  assert.doesNotMatch(result, /recipient:/);
  assert.doesNotMatch(result, /issuer:/);
});

test('shared immutable document projection represents increasing and decreasing effects without conflation', () => {
  assert.match(documentDomain, /record\.adjustmentType === 'INCREASING'/);
  assert.match(documentDomain, /adjustmentType: 'Increasing adjustment'/);
  assert.match(documentDomain, /decreaseTotalMinor: '0'/);
  assert.match(documentDomain, /increaseTotalMinor: snapshot\.increaseTotalMinor/);
  assert.match(documentDomain, /adjustmentType: 'Decreasing adjustment'/);
  assert.match(documentDomain, /increaseTotalMinor: '0'/);
});

test('PDF and accounting projections enforce mutually exclusive direction-aware effects', () => {
  assert.match(pdfDomain, /Increasing adjustment cannot contain a decreasing effect/);
  assert.match(pdfDomain, /Decreasing adjustment cannot contain an increasing effect/);
  assert.match(pdfDomain, /Commercial-amendment increasing price effect is inconsistent/);
  assert.match(accountingDomain, /Increasing adjustment accounting effect is inconsistent/);
  assert.match(accountingDomain, /Decreasing adjustment accounting effect is inconsistent/);
  assert.match(accountingDomain, /total_increase_inc_gst/);
});
