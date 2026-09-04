import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT,
  createHospitalityAdjustmentNoteAccountingCsv,
} from './hospitality-adjustment-note-accounting-export-domain.ts';

const row = {
  documentNumber: 'AU-ADJ-00000007',
  issuedAt: new Date('2026-09-04T05:00:00.000Z'),
  bookingId: '22222222-2222-4222-8222-222222222222',
  sourceTaxInvoiceNumber: 'AU-TAX-00000042',
  sourceTaxInvoiceIssuedAt: new Date('2026-09-03T02:30:00.000Z'),
  currency: 'AUD',
  adjustmentReason: 'Booking cancellation',
  decreaseSubtotalMinor: 10_000n,
  decreaseGstMinor: 1_000n,
  decreaseTotalMinor: 11_000n,
};

const increasing = {
  ...row,
  documentNumber: 'AU-ADJ-00000008',
  adjustmentReason: 'Commercial booking amendment',
  adjustmentType: 'Increasing adjustment' as const,
  decreaseSubtotalMinor: 0n as const,
  decreaseGstMinor: 0n as const,
  decreaseTotalMinor: 0n as const,
  increaseSubtotalMinor: 2_000n,
  increaseGstMinor: 200n,
  increaseTotalMinor: 2_200n,
};

test('exports exact decreasing adjustment-note accounting values without internal payment references', () => {
  const csv = createHospitalityAdjustmentNoteAccountingCsv([row]);
  assert.match(csv, /"AU-ADJ-00000007"/);
  assert.match(csv, /"AU-TAX-00000042"/);
  assert.match(csv, /"Decreasing adjustment","100\.00","10\.00","110\.00","0\.00","0\.00","0\.00"/);
  assert.doesNotMatch(csv, /refund_transaction/i);
  assert.doesNotMatch(csv, /provider/i);
});

test('exports increasing adjustment columns without reusing decreasing columns', () => {
  const csv = createHospitalityAdjustmentNoteAccountingCsv([increasing]);
  assert.match(csv, /"Increasing adjustment","0\.00","0\.00","0\.00","20\.00","2\.00","22\.00"/);
  assert.match(csv, /"adjustment_type"/);
  assert.match(csv, /"total_increase_inc_gst"/);
});

test('rejects mixed or unreconciled directional effects', () => {
  assert.throws(() => createHospitalityAdjustmentNoteAccountingCsv([{
    ...increasing,
    decreaseTotalMinor: 1n as never,
  }]), TypeError);
  assert.throws(() => createHospitalityAdjustmentNoteAccountingCsv([{
    ...increasing,
    increaseGstMinor: 100n,
  }]), TypeError);
});

test('escapes text and uses stable UTC timestamps', () => {
  const csv = createHospitalityAdjustmentNoteAccountingCsv([{ ...row, adjustmentReason: 'Cancellation, "guest request"' }]);
  assert.match(csv, /"2026-09-04T05:00:00\.000Z"/);
  assert.match(csv, /"Cancellation, ""guest request"""/);
});

test('fails closed above the bounded synchronous export limit', () => {
  const rows = Array.from({ length: HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT + 1 }, () => row);
  assert.throws(() => createHospitalityAdjustmentNoteAccountingCsv(rows), RangeError);
});
