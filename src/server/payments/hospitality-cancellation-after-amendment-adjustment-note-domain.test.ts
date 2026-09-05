import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot,
  hospitalityIssuedCancellationAfterAmendmentAdjustmentNoteFingerprint,
  parseHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot,
} from './hospitality-cancellation-after-amendment-adjustment-note-domain.ts';

const base = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  bookingId: '10000000-0000-4000-8000-000000000002',
  sourceInvoiceId: '10000000-0000-4000-8000-000000000003',
  sourceInvoiceDocumentNumber: 'AU-TAX-00000001',
  sourceInvoiceIssuedAt: new Date('2026-09-04T00:00:00.000Z'),
  sourceAdjustmentOrdinal: 3,
  predecessorAdjustmentNoteId: '10000000-0000-4000-8000-000000000004',
  predecessorAdjustmentDocumentNumber: 'AU-ADJ-00000002',
  predecessorAdjustmentIssuedAt: new Date('2026-09-05T01:00:00.000Z'),
  predecessorAdjustmentDocumentFingerprint: 'a'.repeat(64),
  predecessorAfterPricingFingerprint: 'b'.repeat(64),
  beforePricingFingerprint: 'b'.repeat(64),
  beforeTaxMinor: 1_000n,
  beforeTotalMinor: 11_000n,
  refundAuthorities: [
    { refundTransactionId: '20000000-0000-4000-8000-000000000001', refundOrdinal: 1, amountMinor: 8_800n, createdAt: new Date('2026-09-05T02:00:00.000Z') },
    { refundTransactionId: '20000000-0000-4000-8000-000000000002', refundOrdinal: 2, amountMinor: 2_200n, createdAt: new Date('2026-09-05T02:01:00.000Z') },
  ],
  documentNumber: 'AU-ADJ-00000003',
  sequenceValue: 3n,
  issuedAt: new Date('2026-09-05T02:02:00.000Z'),
  currency: 'AUD',
  sourceInvoiceFingerprint: 'c'.repeat(64),
  issuerFingerprint: 'd'.repeat(64),
  recipientFingerprint: 'e'.repeat(64),
  issuer: { legalName: 'SF Hotel Pty Ltd' },
  recipient: { legalName: 'Guest' },
  supplierAbn: '51824753556',
};

test('freezes predecessor-bound terminal cancellation and ordered multi-refund authority', () => {
  const snapshot = createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot(base);
  assert.equal(snapshot.schemaVersion, 6);
  assert.equal(snapshot.sourceAdjustmentOrdinal, '3');
  assert.equal(snapshot.predecessorAdjustmentNoteId, base.predecessorAdjustmentNoteId);
  assert.equal(snapshot.beforeTotalMinor, '11000');
  assert.equal(snapshot.afterTotalMinor, '0');
  assert.equal(snapshot.decreaseSubtotalMinor, '10000');
  assert.equal(snapshot.decreaseTaxMinor, '1000');
  assert.equal(snapshot.refundAuthorities.length, 2);
  assert.match(hospitalityIssuedCancellationAfterAmendmentAdjustmentNoteFingerprint(snapshot), /^[a-f0-9]{64}$/);
  assert.deepEqual(parseHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot(snapshot), snapshot);
});

test('rejects a cancellation whose refund set does not unwind the legal baseline', () => {
  assert.throws(() => createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot({
    ...base,
    refundAuthorities: [base.refundAuthorities[0]!],
  }), /exact verified legal baseline total/);
});

test('rejects duplicate or non-contiguous refund authority', () => {
  assert.throws(() => createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot({
    ...base,
    refundAuthorities: [base.refundAuthorities[0]!, { ...base.refundAuthorities[1]!, refundTransactionId: base.refundAuthorities[0]!.refundTransactionId }],
  }), /duplicate transaction/);
  assert.throws(() => createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot({
    ...base,
    refundAuthorities: [base.refundAuthorities[0]!, { ...base.refundAuthorities[1]!, refundOrdinal: 3 }],
  }), /contiguous/);
});

test('rejects predecessor pricing drift and invalid chronology', () => {
  assert.throws(() => createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot({ ...base, beforePricingFingerprint: 'f'.repeat(64) }), /predecessor after-price/);
  assert.throws(() => createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot({ ...base, issuedAt: new Date('2026-09-05T01:30:00.000Z') }), /chronology/);
});
