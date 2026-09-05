import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const product = readFileSync('src/server/payments/hospitality-commercial-amendment-adjustment-product-service.ts', 'utf8');
const route = readFileSync('app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/adjustment-note/route.ts', 'utf8');
const page = readFileSync('app/invoices/[document-number]/page.tsx', 'utf8');
const action = readFileSync('src/components/commercial-amendment-adjustment-note-action.tsx', 'utf8');

test('product orchestration enforces tenant payment-manage authority before direction discovery', () => {
  assert.match(product, /permission:\s*'payment:manage'/);
  assert.match(product, /organizationId:\s*input\.organizationId/);
  assert.match(product, /bookingId:\s*input\.bookingId/);
  assert.match(product, /documentNumber:\s*sourceInvoiceDocumentNumber/);
  assert.match(product, /isolationLevel:\s*'Serializable'/);
  assert.match(product, /hospitalityIssuedAdjustmentNote\.findFirst/);
  assert.match(product, /const commercialCount = await transaction\.hospitalityIssuedAdjustmentNote\.count/);
  assert.match(product, /loadProductVerifiedChain/);
});

test('product availability derives direction from persisted amendments and rejects same-baseline ambiguity', () => {
  assert.match(product, /direction:\s*\{ in: \['REFUND', 'ADDITIONAL_CHARGE'\] \}/);
  assert.match(product, /competingAppliedBaselineCount/);
  assert.match(product, /candidate\.direction !== 'REFUND'/);
  assert.match(product, /candidate\.direction !== 'ADDITIONAL_CHARGE'/);
  assert.match(product, /adjustmentType:\s*'DECREASING'/);
  assert.match(product, /adjustmentType:\s*'INCREASING'/);
  assert.match(product, /Multiple applied commercial amendments compete/);
  assert.match(product, /getHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNoteAvailability/);
});

test('exact retries prove complete tenant-source chain membership before returning existing legal evidence', () => {
  assert.match(product, /commercialAmendmentId:\s*input\.commercialAmendmentId/);
  assert.match(product, /existing\.bookingId !== input\.bookingId/);
  assert.match(product, /existing\.sourceInvoiceId !== sourceInvoice\.id/);
  assert.match(product, /const chain = await loadProductVerifiedChain/);
  assert.match(product, /chain\.priorAdjustments\.find/);
  assert.match(product, /entry\.adjustmentNoteId === existing\.id/);
  assert.match(product, /if \(existing\) return existing/);
});

test('route accepts no browser-selected legal direction and returns both directional effects', () => {
  assert.match(route, /as \{ sourceInvoiceDocumentNumber\?: unknown \}/);
  assert.doesNotMatch(route, /adjustmentType\?: unknown/);
  assert.doesNotMatch(route, /direction\?: unknown/);
  assert.match(route, /adjustmentType:\s*issued\.adjustmentType/);
  assert.match(route, /decreaseTotalMinor:\s*issued\.decreaseTotalMinor/);
  assert.match(route, /increaseTotalMinor:\s*issued\.increaseTotalMinor/);
});

test('tax-invoice action displays server-derived direction and ordinal but sends only source invoice authority', () => {
  assert.match(page, /adjustmentType=\{commercialAdjustmentAvailability\.adjustmentType\}/);
  assert.match(page, /sourceAdjustmentOrdinal=\{commercialAdjustmentAvailability\.sourceAdjustmentOrdinal\}/);
  assert.match(action, /adjustmentType: 'DECREASING' \| 'INCREASING'/);
  assert.match(action, /adjustmentType === 'INCREASING'/);
  assert.match(action, /const repeated = sourceAdjustmentOrdinal > 1/);
  assert.match(action, /Issue next increase adjustment note/);
  assert.match(action, /applied price increase/);
  assert.match(action, /body: JSON\.stringify\(\{ sourceInvoiceDocumentNumber \}\)/);
  assert.doesNotMatch(action, /JSON\.stringify\(\{[^}]*adjustmentType/);
  assert.doesNotMatch(action, /JSON\.stringify\(\{[^}]*sourceAdjustmentOrdinal/);
});
