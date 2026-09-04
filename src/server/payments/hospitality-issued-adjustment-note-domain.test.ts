import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateAustralianCancellationDecrease,
  createHospitalityIssuedCancellationAdjustmentNoteSnapshot,
  formatAustralianAdjustmentNoteDocumentNumber,
  hospitalityIssuedAdjustmentNoteFingerprint,
  parseHospitalityIssuedCancellationAdjustmentNoteSnapshot,
} from './hospitality-issued-adjustment-note-domain.ts';

const ids = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  bookingId: '22222222-2222-4222-8222-222222222222',
  sourceInvoiceId: '33333333-3333-4333-8333-333333333333',
  refundTransactionId: '44444444-4444-4444-8444-444444444444',
};

function createSnapshot() {
  return createHospitalityIssuedCancellationAdjustmentNoteSnapshot({
    ...ids,
    sourceInvoiceDocumentNumber: 'AU-TAX-00000001',
    sourceInvoiceIssuedAt: new Date('2026-09-04T01:00:00.000Z'),
    documentNumber: 'AU-ADJ-00000001',
    sequenceValue: 1n,
    issuedAt: new Date('2026-09-04T02:00:00.000Z'),
    currency: 'AUD',
    decreaseTotalMinor: 11_000n,
    sourceInvoiceFingerprint: 'a'.repeat(64),
    issuerFingerprint: 'b'.repeat(64),
    recipientFingerprint: 'c'.repeat(64),
    issuer: { legalName: 'Example Pty Ltd' },
    recipient: { legalName: 'Guest' },
    supplierAbn: '51824753556',
  });
}

test('derives exact standard GST decrease for cancellation', () => {
  assert.deepEqual(calculateAustralianCancellationDecrease(11_000n), {
    decreaseSubtotalMinor: 10_000n,
    decreaseTaxMinor: 1_000n,
    decreaseTotalMinor: 11_000n,
  });
});

test('fails closed when cancellation refund cannot preserve exact 1/11 GST evidence', () => {
  assert.throws(() => calculateAustralianCancellationDecrease(10_999n), /divisible exactly by 11/);
});

test('formats separate Australian adjustment-note numbering', () => {
  assert.equal(formatAustralianAdjustmentNoteDocumentNumber(42n), 'AU-ADJ-00000042');
});

test('round trips immutable cancellation adjustment evidence', () => {
  const value = createSnapshot();
  assert.deepEqual(parseHospitalityIssuedCancellationAdjustmentNoteSnapshot(JSON.parse(JSON.stringify(value))), value);
  assert.match(hospitalityIssuedAdjustmentNoteFingerprint(value), /^[a-f0-9]{64}$/);
});

test('rejects adjustment notes that predate the source tax invoice', () => {
  assert.throws(() => createHospitalityIssuedCancellationAdjustmentNoteSnapshot({
    ...ids,
    sourceInvoiceDocumentNumber: 'AU-TAX-00000001',
    sourceInvoiceIssuedAt: new Date('2026-09-04T03:00:00.000Z'),
    documentNumber: 'AU-ADJ-00000001',
    sequenceValue: 1n,
    issuedAt: new Date('2026-09-04T02:00:00.000Z'),
    currency: 'AUD',
    decreaseTotalMinor: 11_000n,
    sourceInvoiceFingerprint: 'a'.repeat(64),
    issuerFingerprint: 'b'.repeat(64),
    recipientFingerprint: 'c'.repeat(64),
    issuer: {},
    recipient: {},
    supplierAbn: '51824753556',
  }), /cannot predate/);
});
