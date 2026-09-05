import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authority = readFileSync('src/server/payments/hospitality-issued-adjustment-note-authority-service.ts', 'utf8');
const service = readFileSync('src/server/payments/public-issued-tax-invoice-service.ts', 'utf8');

test('public adjustment history delegates all commercial directions to the shared complete-chain authority', () => {
  assert.match(service, /validateHospitalityIssuedAdjustmentNoteRows/);
  assert.doesNotMatch(service, /verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows/);
  assert.match(authority, /verifyHospitalityCommercialAmendmentAdjustmentRows/);
  assert.match(authority, /kind: 'COMMERCIAL_AMENDMENT'/);
});

test('public authority verification runs only after tenant and booking capability ownership checks', () => {
  const ownership = service.indexOf('publicBookingBookingOwnership.findUnique');
  const authorityUse = service.indexOf('validatedAdjustments = await validateHospitalityIssuedAdjustmentNoteRows', ownership);
  assert.ok(ownership >= 0 && authorityUse > ownership);
  assert.match(service, /expectedOrganizationId: branding\.id/);
  assert.match(service, /organizationId_bookingId: \{ organizationId: branding\.id, bookingId: capability\.bookingId \}/);
  assert.match(service, /organizationId: branding\.id,\n\s+bookingId: capability\.bookingId/);
});

test('public customer projection remains free of internal chain, amendment, payment and fingerprint authority', () => {
  const projectionStart = service.indexOf('function customerAdjustmentDocument');
  const projectionEnd = service.indexOf('export async function listPublicBookingIssuedTaxInvoices');
  const projection = service.slice(projectionStart, projectionEnd);
  assert.doesNotMatch(projection, /predecessorAdjustmentNoteId/);
  assert.doesNotMatch(projection, /documentFingerprint/);
  assert.doesNotMatch(projection, /commercialAmendmentId/);
  assert.doesNotMatch(projection, /targetPricingEvidenceId/);
  assert.doesNotMatch(projection, /providerReference/);
  assert.match(projection, /increaseTotalMinor: document\.increaseTotalMinor/);
  assert.match(projection, /decreaseTotalMinor: document\.decreaseTotalMinor/);
});
