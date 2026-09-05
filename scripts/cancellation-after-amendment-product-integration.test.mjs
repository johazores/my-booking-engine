import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/bookings/hospitality/[booking-id]/adjustment-notes/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/invoices/[document-number]/page.tsx', import.meta.url), 'utf8');
const action = readFileSync(new URL('../src/components/cancellation-adjustment-note-action.tsx', import.meta.url), 'utf8');
const product = readFileSync(new URL('../src/server/payments/hospitality-cancellation-adjustment-product-service.ts', import.meta.url), 'utf8');
const legacy = readFileSync(new URL('../src/server/payments/hospitality-adjustment-note-service.ts', import.meta.url), 'utf8');
const terminal = readFileSync(new URL('../src/server/payments/hospitality-cancellation-after-amendment-adjustment-service.ts', import.meta.url), 'utf8');

test('tax-invoice page uses one server-selected cancellation authority before commercial issuance', () => {
  const cancellationIndex = page.indexOf('const cancellationAdjustmentAvailability =');
  const commercialIndex = page.indexOf('const commercialAdjustmentAvailability =');
  assert.ok(cancellationIndex >= 0 && commercialIndex > cancellationIndex);
  assert.match(page, /getHospitalityCancellationAdjustmentNoteProductAvailability/);
  assert.doesNotMatch(page, /legacyCancellationAvailability/);
  assert.doesNotMatch(page, /cancellationAfterAmendmentAvailability/);
  assert.match(page, /!cancellationAvailable[\s\S]*getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability/);
});

test('browser cancellation request carries only the source invoice number', () => {
  assert.match(action, /JSON\.stringify\(\{ sourceInvoiceDocumentNumber \}\)/);
  assert.doesNotMatch(action, /refundTransactionId/);
  assert.doesNotMatch(action, /predecessorAdjustmentNoteId/);
  assert.doesNotMatch(action, /decreaseTotalMinor/);
  assert.match(action, /sourceAdjustmentOrdinal > 1/);
});

test('cancellation API no longer lets request shape choose legacy versus terminal issuance', () => {
  assert.match(route, /issueHospitalityCancellationAdjustmentNoteForSource/);
  assert.doesNotMatch(route, /refundTransactionId/);
  assert.doesNotMatch(route, /issueHospitalityCancellationAdjustmentNote\(/);
  assert.doesNotMatch(route, /issueHospitalityCancellationAfterAmendmentAdjustmentNote\(/);
});

test('product authority requires payment management and tenant-scopes source inspection', () => {
  assert.match(product, /permission: 'payment:manage'/);
  assert.match(product, /organizationId: input\.organizationId/);
  assert.match(product, /bookingId: input\.bookingId/);
  assert.match(product, /jurisdictionCode: 'AU'/);
  assert.match(product, /documentType: 'TAX_INVOICE'/);
});

test('product authority derives the cancellation path from persisted legal evidence', () => {
  assert.match(product, /version === 1/);
  assert.match(product, /EXISTING_UNADJUSTED/);
  assert.match(product, /version === 6/);
  assert.match(product, /EXISTING_AFTER_COMMERCIAL_AMENDMENT/);
  assert.match(product, /adjustmentReason: 'COMMERCIAL_AMENDMENT'/);
  assert.match(product, /AFTER_COMMERCIAL_AMENDMENT/);
  assert.match(product, /UNADJUSTED/);
});

test('legacy refund identity stays server-derived and is never exposed by product availability', () => {
  assert.match(legacy, /take: 2/);
  assert.match(legacy, /return Object\.freeze\(\{ available: true as const, refundTransactionId: refunds\[0\]!\.id \}\)/);
  assert.match(product, /refundTransactionId: availability\.refundTransactionId/);
  assert.match(product, /sourceAdjustmentOrdinal: 1/);
  assert.doesNotMatch(product, /return Object\.freeze\(\{[\s\S]{0,160}available: true as const,[\s\S]{0,160}refundTransactionId/);
});

test('existing cancellation links are dispatched through the verifier matching their evidence schema', () => {
  assert.match(product, /state\.path === 'UNADJUSTED' \|\| state\.path === 'EXISTING_UNADJUSTED'[\s\S]*getHospitalityCancellationAdjustmentNoteAvailability/);
  assert.match(product, /getHospitalityCancellationAfterAmendmentAdjustmentNoteAvailability[\s\S]*state\.path === 'EXISTING_AFTER_COMMERCIAL_AMENDMENT'/);
  assert.match(terminal, /schemaVersion\(existingCancellation\.documentSnapshot\) === 6/);
  assert.match(terminal, /verifyHospitalityCancellationAfterAmendmentAdjustmentRowInTransaction/);
});
