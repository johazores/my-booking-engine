import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('commercial adjustment authority reconstruction uses one repeatable-read snapshot', async () => {
  const source = await read('src/server/payments/hospitality-commercial-amendment-adjustment-chain-read-service.ts');

  assert.match(source, /verifyHospitalityCommercialAmendmentAdjustmentRows/);
  assert.match(source, /loadVerifiedHospitalityCommercialAmendmentAdjustmentChain/);
  assert.match(source, /organizationId: input\.organizationId/);
  assert.match(source, /bookingId: first\.bookingId/);
  assert.match(source, /sourceInvoiceId: first\.sourceInvoiceId/);
  assert.match(source, /allowTerminalCancellation: true/);
  assert.match(source, /\{ isolationLevel: 'RepeatableRead' \}/);
});

test('terminal cancellation authority reconstruction uses one repeatable-read snapshot', async () => {
  const source = await read('src/server/payments/hospitality-cancellation-after-amendment-adjustment-authority-service.ts');

  assert.match(source, /verifyHospitalityCancellationAfterAmendmentAdjustmentRows/);
  assert.match(source, /verifyHospitalityCancellationAfterAmendmentAdjustmentRowInTransaction/);
  assert.match(source, /organizationId: input\.organizationId/);
  assert.match(source, /row,/);
  assert.match(source, /\{ isolationLevel: 'RepeatableRead' \}/);
});

test('terminal cancellation verifier keeps complete issue-time authority inside the caller transaction', async () => {
  const source = await read('src/server/payments/hospitality-cancellation-after-amendment-adjustment-authority-service.ts');

  assert.match(source, /loadVerifiedHospitalityCommercialAmendmentAdjustmentChain\(\{[\s\S]*transaction: input\.transaction/);
  assert.match(source, /hospitalityIssuedInvoice\.findFirst\(\{[\s\S]*organizationId: input\.organizationId[\s\S]*bookingId: input\.row\.bookingId/);
  assert.match(source, /hospitalityBooking\.findFirst\(\{[\s\S]*id: input\.row\.bookingId[\s\S]*organizationId: input\.organizationId/);
  assert.match(source, /readHospitalityLegalPaymentEvidenceHistory\(\{[\s\S]*transaction: input\.transaction[\s\S]*through: input\.row\.issuedAt/);
  assert.match(source, /verifyFrozenRefundAuthorities/);
});

test('documentation separates snapshot consistency from unresolved frozen settlement evidence', async () => {
  const source = await read('docs/adjustment-note-authority-read-consistency.md');

  assert.match(source, /RepeatableRead/);
  assert.match(source, /schemas 2 through 5/);
  assert.match(source, /provider lifecycle status can change later/);
  assert.match(source, /does not.*claim.*solve/is);
});
