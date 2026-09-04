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
  assert.match(product, /const adjustmentCount = await transaction\.hospitalityIssuedAdjustmentNote\.count/);
});

test('product availability derives direction from persisted amendments and rejects same-baseline ambiguity', () => {
  assert.match(product, /direction:\s*\{ in: \['REFUND', 'ADDITIONAL_CHARGE'\] \}/);
  assert.match(product, /competingAppliedBaselineCount/);
  assert.match(product, /candidate\.direction !== 'REFUND'/);
  assert.match(product, /candidate\.direction !== 'ADDITIONAL_CHARGE'/);
  assert.match(product, /adjustmentType:\s*'DECREASING'/);
  assert.match(product, /adjustmentType:\s*'INCREASING'/);
  assert.match(product, /Multiple applied commercial amendments compete/);
});

test('increasing exact retries re-prove post-issuance authority before invoking the idempotent writer', () => {
  assert.match(product, /existing\?\.adjustmentType === 'INCREASING'/);
  assert.match(product, /verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows/);
  assert.match(product, /verified\[0\]!\.commercialAmendmentId !== input\.commercialAmendmentId/);
  assert.match(product, /issueIncreasingAdjustment\(input, sourceInvoiceDocumentNumber\)/);
});

test('route accepts no browser-selected legal direction and returns both directional effects', () => {
  assert.match(route, /as \{ sourceInvoiceDocumentNumber\?: unknown \}/);
  assert.doesNotMatch(route, /adjustmentType\?: unknown/);
  assert.doesNotMatch(route, /direction\?: unknown/);
  assert.match(route, /adjustmentType:\s*issued\.adjustmentType/);
  assert.match(route, /decreaseTotalMinor:\s*issued\.decreaseTotalMinor/);
  assert.match(route, /increaseTotalMinor:\s*issued\.increaseTotalMinor/);
});

test('tax-invoice action displays server-derived direction but does not send it back as authority', () => {
  assert.match(page, /adjustmentType=\{commercialAdjustmentAvailability\.adjustmentType\}/);
  assert.match(action, /adjustmentType: 'DECREASING' \| 'INCREASING'/);
  assert.match(action, /adjustmentType === 'INCREASING'/);
  assert.match(action, /Issue increase adjustment note/);
  assert.match(action, /applied price increase/);
  assert.match(action, /body: JSON\.stringify\(\{ sourceInvoiceDocumentNumber \}\)/);
  assert.doesNotMatch(action, /JSON\.stringify\(\{[^}]*adjustmentType/);
});
