import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/bookings/hospitality/[booking-id]/adjustment-notes/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/invoices/[document-number]/page.tsx', import.meta.url), 'utf8');
const action = readFileSync(new URL('../src/components/cancellation-adjustment-note-action.tsx', import.meta.url), 'utf8');
const availability = readFileSync(new URL('../src/server/payments/hospitality-cancellation-after-amendment-adjustment-service.ts', import.meta.url), 'utf8');

test('invoice page gives terminal cancellation authority priority before legacy and commercial issuance', () => {
  const terminalIndex = page.indexOf('const cancellationAfterAmendmentAvailability =');
  const legacyIndex = page.indexOf('const legacyCancellationAvailability =');
  const commercialIndex = page.indexOf('const commercialAdjustmentAvailability =');
  assert.ok(terminalIndex >= 0 && legacyIndex > terminalIndex && commercialIndex > legacyIndex);
  assert.match(page, /!cancellationAvailable[\s\S]*getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability/);
  assert.match(page, /sourceAdjustmentOrdinal=\{cancellationAfterAmendmentAvailability\.sourceAdjustmentOrdinal\}/);
});

test('browser never sends terminal refund ids, legal money, ordinal, or predecessor authority', () => {
  assert.match(action, /refundTransactionId\s*\?\s*\{ sourceInvoiceDocumentNumber, refundTransactionId \}\s*:\s*\{ sourceInvoiceDocumentNumber \}/);
  assert.doesNotMatch(action, /JSON\.stringify\([^\n]*sourceAdjustmentOrdinal/);
  assert.doesNotMatch(action, /predecessorAdjustmentNoteId/);
  assert.doesNotMatch(action, /decreaseTotalMinor/);
});

test('existing route remains backward compatible while server-selecting terminal cancellation when no legacy refund id is supplied', () => {
  assert.match(route, /typeof body\.refundTransactionId === 'string'[\s\S]*issueHospitalityCancellationAdjustmentNote/);
  assert.match(route, /issueHospitalityCancellationAfterAmendmentAdjustmentNote/);
  assert.match(route, /sourceInvoiceDocumentNumber: body\.sourceInvoiceDocumentNumber/);
});

test('availability independently verifies an already-issued schema-version-6 terminal document before exposing its link', () => {
  assert.match(availability, /schemaVersion\(existingCancellation\.documentSnapshot\) === 6/);
  assert.match(availability, /verifyHospitalityCancellationAfterAmendmentAdjustmentRowInTransaction/);
  assert.match(availability, /organizationId: input\.organizationId/);
});
