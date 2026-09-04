import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot,
  hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint,
  parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-adjustment-note-domain.ts';

const ids = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  bookingId: '22222222-2222-4222-8222-222222222222',
  sourceInvoiceId: '33333333-3333-4333-8333-333333333333',
  commercialAmendmentId: '44444444-4444-4444-8444-444444444444',
  targetPricingEvidenceId: '55555555-5555-4555-8555-555555555555',
};

function createSnapshot() {
  return createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot({
    ...ids,
    sourceInvoiceDocumentNumber: 'AU-TAX-00000001',
    sourceInvoiceIssuedAt: new Date('2026-09-04T01:00:00.000Z'),
    commercialAmendmentAppliedAt: new Date('2026-09-04T02:00:00.000Z'),
    sourceAdjustmentOrdinal: 1,
    documentNumber: 'AU-ADJ-00000002',
    sequenceValue: 2n,
    issuedAt: new Date('2026-09-04T03:00:00.000Z'),
    currency: 'AUD',
    beforeTaxMinor: 10_000n,
    beforeTotalMinor: 110_000n,
    afterTaxMinor: 8_000n,
    afterTotalMinor: 88_000n,
    sourceInvoiceFingerprint: 'a'.repeat(64),
    beforePricingFingerprint: 'b'.repeat(64),
    afterPricingFingerprint: 'c'.repeat(64),
    issuerFingerprint: 'd'.repeat(64),
    recipientFingerprint: 'e'.repeat(64),
    issuer: { legalName: 'Example Pty Ltd' },
    recipient: { legalName: 'Guest' },
    supplierAbn: '51824753556',
  });
}

test('creates immutable commercial-amendment adjustment evidence without one refund authority row', () => {
  const snapshot = createSnapshot();
  assert.equal(snapshot.adjustmentReason, 'COMMERCIAL_AMENDMENT');
  assert.equal(snapshot.commercialAmendmentId, ids.commercialAmendmentId);
  assert.equal(snapshot.targetPricingEvidenceId, ids.targetPricingEvidenceId);
  assert.equal(snapshot.sourceAdjustmentOrdinal, '1');
  assert.equal(snapshot.decreaseSubtotalMinor, '20000');
  assert.equal(snapshot.decreaseTaxMinor, '2000');
  assert.equal(snapshot.decreaseTotalMinor, '22000');
  assert.equal('refundTransactionId' in snapshot, false);
});

test('round trips the schema version 2 commercial-amendment snapshot deterministically', () => {
  const snapshot = createSnapshot();
  const parsed = parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot(
    JSON.parse(JSON.stringify(snapshot)),
  );
  assert.deepEqual(parsed, snapshot);
  assert.equal(
    hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint(parsed),
    hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint(snapshot),
  );
});

test('rejects unsupported cumulative ordinals until multiple-adjustment semantics exist', () => {
  assert.throws(() => createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot({
    ...ids,
    sourceInvoiceDocumentNumber: 'AU-TAX-00000001',
    sourceInvoiceIssuedAt: new Date('2026-09-04T01:00:00.000Z'),
    commercialAmendmentAppliedAt: new Date('2026-09-04T02:00:00.000Z'),
    sourceAdjustmentOrdinal: 2,
    documentNumber: 'AU-ADJ-00000002',
    sequenceValue: 2n,
    issuedAt: new Date('2026-09-04T03:00:00.000Z'),
    currency: 'AUD',
    beforeTaxMinor: 10_000n,
    beforeTotalMinor: 110_000n,
    afterTaxMinor: 8_000n,
    afterTotalMinor: 88_000n,
    sourceInvoiceFingerprint: 'a'.repeat(64),
    beforePricingFingerprint: 'b'.repeat(64),
    afterPricingFingerprint: 'c'.repeat(64),
    issuerFingerprint: 'd'.repeat(64),
    recipientFingerprint: 'e'.repeat(64),
    issuer: {},
    recipient: {},
    supplierAbn: '51824753556',
  }), /supports only the first legal adjustment/);
});

test('rejects commercial amendment evidence that predates its source invoice', () => {
  const snapshot = createSnapshot();
  assert.throws(() => createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot({
    ...ids,
    sourceInvoiceDocumentNumber: snapshot.sourceInvoiceDocumentNumber,
    sourceInvoiceIssuedAt: new Date('2026-09-04T04:00:00.000Z'),
    commercialAmendmentAppliedAt: new Date('2026-09-04T02:00:00.000Z'),
    sourceAdjustmentOrdinal: 1,
    documentNumber: snapshot.documentNumber,
    sequenceValue: 2n,
    issuedAt: new Date('2026-09-04T05:00:00.000Z'),
    currency: 'AUD',
    beforeTaxMinor: 10_000n,
    beforeTotalMinor: 110_000n,
    afterTaxMinor: 8_000n,
    afterTotalMinor: 88_000n,
    sourceInvoiceFingerprint: 'a'.repeat(64),
    beforePricingFingerprint: 'b'.repeat(64),
    afterPricingFingerprint: 'c'.repeat(64),
    issuerFingerprint: 'd'.repeat(64),
    recipientFingerprint: 'e'.repeat(64),
    issuer: {},
    recipient: {},
    supplierAbn: '51824753556',
  }), /cannot predate its source tax invoice/);
});

test('rejects non-standard-GST before or after evidence', () => {
  assert.throws(() => createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot({
    ...ids,
    sourceInvoiceDocumentNumber: 'AU-TAX-00000001',
    sourceInvoiceIssuedAt: new Date('2026-09-04T01:00:00.000Z'),
    commercialAmendmentAppliedAt: new Date('2026-09-04T02:00:00.000Z'),
    sourceAdjustmentOrdinal: 1,
    documentNumber: 'AU-ADJ-00000002',
    sequenceValue: 2n,
    issuedAt: new Date('2026-09-04T03:00:00.000Z'),
    currency: 'AUD',
    beforeTaxMinor: 10_001n,
    beforeTotalMinor: 110_000n,
    afterTaxMinor: 8_000n,
    afterTotalMinor: 88_000n,
    sourceInvoiceFingerprint: 'a'.repeat(64),
    beforePricingFingerprint: 'b'.repeat(64),
    afterPricingFingerprint: 'c'.repeat(64),
    issuerFingerprint: 'd'.repeat(64),
    recipientFingerprint: 'e'.repeat(64),
    issuer: {},
    recipient: {},
    supplierAbn: '51824753556',
  }), /fully taxable standard-GST/);
});
