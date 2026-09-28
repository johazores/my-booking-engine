import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authority = readFileSync('src/server/payments/hospitality-issued-adjustment-note-authority-service.ts', 'utf8');
const service = readFileSync('src/server/payments/public-issued-tax-invoice-service.ts', 'utf8');

test('public adjustment history delegates all commercial directions to the shared complete-chain authority', () => {
  assert.match(service, /validateHospitalityIssuedAdjustmentNoteRowsInTransaction/);
  assert.doesNotMatch(service, /verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows/);
  assert.match(authority, /verifyHospitalityCommercialAmendmentAdjustmentRowsInTransaction/);
  assert.match(authority, /kind: 'COMMERCIAL_AMENDMENT'/);
});

test('public authority verification proves persisted principal ownership before tenant booking and legal authority', () => {
  const helperStart = service.indexOf('async function assertPublicDocumentAuthority');
  const helperEnd = service.indexOf('export async function listPublicBookingIssuedTaxInvoices', helperStart);
  const helper = service.slice(helperStart, helperEnd);
  const ownership = helper.indexOf('transaction.publicBookingBookingOwnership.findUnique');
  const principal = helper.indexOf('transaction.publicBookingPrincipal.findFirst');
  const authorization = helper.indexOf(
    'if (!ownership || ownership.principalId !== authority.principalId || !principal)',
  );
  const booking = helper.indexOf('transaction.hospitalityBooking.findFirst');
  const listStart = service.indexOf('export async function listPublicBookingIssuedTaxInvoices');
  const authorityUse = service.indexOf(
    'validatedAdjustments = await validateHospitalityIssuedAdjustmentNoteRowsInTransaction',
    listStart,
  );
  assert.ok(ownership >= 0);
  assert.ok(principal >= 0);
  assert.ok(authorization > ownership && authorization > principal);
  assert.ok(booking > authorization);
  assert.ok(authorityUse > listStart);
  assert.match(service, /expectedOrganizationId: branding\.id/);
  assert.match(service, /organizationId: authority\.organizationId,\n\s+bookingId: authority\.bookingId/);
  assert.match(service, /transaction,\n\s+organizationId: authority\.organizationId,\n\s+rows: adjustmentRows/);
  assert.match(service, /isolationLevel: 'RepeatableRead'/);
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
