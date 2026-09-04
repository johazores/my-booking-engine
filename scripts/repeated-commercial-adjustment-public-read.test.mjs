import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('src/server/payments/public-issued-tax-invoice-service.ts', 'utf8');

test('public schema-v3 adjustment projection binds predecessor material fields', () => {
  assert.match(service, /snapshot\.schemaVersion === 2/);
  assert.match(service, /row\.sourceAdjustmentOrdinal >= 2/);
  assert.match(service, /row\.predecessorAdjustmentNoteId === snapshot\.predecessorAdjustmentNoteId/);
  assert.match(service, /row\.predecessorSourceAdjustmentOrdinal === row\.sourceAdjustmentOrdinal - 1/);
});

test('public commercial adjustment history verifies the complete source chain after capability ownership authorization', () => {
  const ownership = service.indexOf('publicBookingBookingOwnership.findUnique');
  const chain = service.indexOf('await verifyHospitalityCommercialAmendmentAdjustmentRows', ownership);
  assert.ok(ownership >= 0 && chain > ownership);
  assert.match(service, /organizationId:\s*branding\.id/);
  assert.match(service, /bookingId:\s*capability\.bookingId/);
  assert.match(service, /rows:\s*commercialItems\.map/);
});

test('public customer projection remains free of internal predecessor ids and fingerprints', () => {
  const projectionStart = service.indexOf('function customerAdjustmentDocument');
  const projectionEnd = service.indexOf('export async function listPublicBookingIssuedTaxInvoices');
  const projection = service.slice(projectionStart, projectionEnd);
  assert.doesNotMatch(projection, /predecessorAdjustmentNoteId/);
  assert.doesNotMatch(projection, /documentFingerprint/);
  assert.doesNotMatch(projection, /commercialAmendmentId/);
  assert.doesNotMatch(projection, /targetPricingEvidenceId/);
});
