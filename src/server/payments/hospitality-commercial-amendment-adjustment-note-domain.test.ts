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

function firstSnapshot() {
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

function repeatedSnapshot() {
  return createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot({
    ...ids,
    commercialAmendmentId: '66666666-6666-4666-8666-666666666666',
    targetPricingEvidenceId: '77777777-7777-4777-8777-777777777777',
    sourceInvoiceDocumentNumber: 'AU-TAX-00000001',
    sourceInvoiceIssuedAt: new Date('2026-09-04T01:00:00.000Z'),
    commercialAmendmentAppliedAt: new Date('2026-09-04T04:00:00.000Z'),
    sourceAdjustmentOrdinal: 2,
    predecessorAdjustment: {
      adjustmentNoteId: '88888888-8888-4888-8888-888888888888',
      sourceAdjustmentOrdinal: 1,
      documentNumber: 'AU-ADJ-00000002',
      issuedAt: new Date('2026-09-04T03:00:00.000Z'),
      documentFingerprint: 'f'.repeat(64),
      afterPricingFingerprint: 'c'.repeat(64),
    },
    documentNumber: 'AU-ADJ-00000003',
    sequenceValue: 3n,
    issuedAt: new Date('2026-09-04T05:00:00.000Z'),
    currency: 'AUD',
    beforeTaxMinor: 8_000n,
    beforeTotalMinor: 88_000n,
    afterTaxMinor: 7_000n,
    afterTotalMinor: 77_000n,
    sourceInvoiceFingerprint: 'a'.repeat(64),
    beforePricingFingerprint: 'c'.repeat(64),
    afterPricingFingerprint: '9'.repeat(64),
    issuerFingerprint: 'd'.repeat(64),
    recipientFingerprint: 'e'.repeat(64),
    issuer: { legalName: 'Example Pty Ltd' },
    recipient: { legalName: 'Guest' },
    supplierAbn: '51824753556',
  });
}

test('keeps first commercial-amendment adjustment evidence on schema version 2', () => {
  const snapshot = firstSnapshot();
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.adjustmentReason, 'COMMERCIAL_AMENDMENT');
  assert.equal(snapshot.commercialAmendmentId, ids.commercialAmendmentId);
  assert.equal(snapshot.targetPricingEvidenceId, ids.targetPricingEvidenceId);
  assert.equal(snapshot.sourceAdjustmentOrdinal, '1');
  assert.equal(snapshot.decreaseSubtotalMinor, '20000');
  assert.equal(snapshot.decreaseTaxMinor, '2000');
  assert.equal(snapshot.decreaseTotalMinor, '22000');
  assert.equal('refundTransactionId' in snapshot, false);
  assert.equal('predecessorAdjustmentNoteId' in snapshot, false);
});

test('round trips schema version 2 deterministically', () => {
  const snapshot = firstSnapshot();
  const parsed = parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot(
    JSON.parse(JSON.stringify(snapshot)),
  );
  assert.deepEqual(parsed, snapshot);
  assert.equal(
    hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint(parsed),
    hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint(snapshot),
  );
});

test('creates schema version 3 repeated adjustment evidence bound to its immediate predecessor', () => {
  const snapshot = repeatedSnapshot();
  assert.equal(snapshot.schemaVersion, 3);
  if (snapshot.schemaVersion !== 3) assert.fail('Expected repeated snapshot schema version 3.');
  assert.equal(snapshot.sourceAdjustmentOrdinal, '2');
  assert.equal(snapshot.predecessorAdjustmentNoteId, '88888888-8888-4888-8888-888888888888');
  assert.equal(snapshot.predecessorAdjustmentDocumentNumber, 'AU-ADJ-00000002');
  assert.equal(snapshot.predecessorAdjustmentDocumentFingerprint, 'f'.repeat(64));
  assert.equal(snapshot.predecessorAfterPricingFingerprint, 'c'.repeat(64));
  assert.equal(snapshot.beforePricingFingerprint, snapshot.predecessorAfterPricingFingerprint);
  assert.equal(snapshot.decreaseSubtotalMinor, '10000');
  assert.equal(snapshot.decreaseTaxMinor, '1000');
  assert.equal(snapshot.decreaseTotalMinor, '11000');
});

test('round trips schema version 3 deterministically and binds predecessor evidence into the fingerprint', () => {
  const snapshot = repeatedSnapshot();
  const parsed = parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot(
    JSON.parse(JSON.stringify(snapshot)),
  );
  assert.deepEqual(parsed, snapshot);
  assert.equal(
    hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint(parsed),
    hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint(snapshot),
  );

  const tampered = {
    ...JSON.parse(JSON.stringify(snapshot)),
    predecessorAdjustmentDocumentFingerprint: '1'.repeat(64),
  };
  const parsedTampered = parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot(tampered);
  assert.notEqual(
    hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint(parsedTampered),
    hospitalityIssuedCommercialAmendmentAdjustmentNoteFingerprint(snapshot),
  );
});

test('rejects repeated adjustment evidence without a predecessor', () => {
  const first = firstSnapshot();
  assert.throws(() => createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot({
    ...ids,
    sourceInvoiceDocumentNumber: first.sourceInvoiceDocumentNumber,
    sourceInvoiceIssuedAt: new Date(first.sourceInvoiceIssuedAt),
    commercialAmendmentAppliedAt: new Date('2026-09-04T04:00:00.000Z'),
    sourceAdjustmentOrdinal: 2,
    documentNumber: 'AU-ADJ-00000003',
    sequenceValue: 3n,
    issuedAt: new Date('2026-09-04T05:00:00.000Z'),
    currency: 'AUD',
    beforeTaxMinor: 8_000n,
    beforeTotalMinor: 88_000n,
    afterTaxMinor: 7_000n,
    afterTotalMinor: 77_000n,
    sourceInvoiceFingerprint: 'a'.repeat(64),
    beforePricingFingerprint: 'c'.repeat(64),
    afterPricingFingerprint: '9'.repeat(64),
    issuerFingerprint: 'd'.repeat(64),
    recipientFingerprint: 'e'.repeat(64),
    issuer: {},
    recipient: {},
    supplierAbn: '51824753556',
  }), /require immutable predecessor authority/);
});

test('rejects a predecessor ordinal gap', () => {
  assert.throws(() => createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot({
    ...repeatedSnapshot(),
    sourceInvoiceIssuedAt: new Date('2026-09-04T01:00:00.000Z'),
    commercialAmendmentAppliedAt: new Date('2026-09-04T04:00:00.000Z'),
    sourceAdjustmentOrdinal: 3,
    predecessorAdjustment: {
      adjustmentNoteId: '88888888-8888-4888-8888-888888888888',
      sourceAdjustmentOrdinal: 1,
      documentNumber: 'AU-ADJ-00000002',
      issuedAt: new Date('2026-09-04T03:00:00.000Z'),
      documentFingerprint: 'f'.repeat(64),
      afterPricingFingerprint: 'c'.repeat(64),
    },
    sequenceValue: 3n,
    issuedAt: new Date('2026-09-04T05:00:00.000Z'),
    beforeTaxMinor: 8_000n,
    beforeTotalMinor: 88_000n,
    afterTaxMinor: 7_000n,
    afterTotalMinor: 77_000n,
    supplierAbn: '51824753556',
  }), /continue the predecessor ordinal exactly/);
});

test('rejects a repeated adjustment whose before fingerprint is not the predecessor after fingerprint', () => {
  assert.throws(() => createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot({
    ...ids,
    commercialAmendmentId: '66666666-6666-4666-8666-666666666666',
    targetPricingEvidenceId: '77777777-7777-4777-8777-777777777777',
    sourceInvoiceDocumentNumber: 'AU-TAX-00000001',
    sourceInvoiceIssuedAt: new Date('2026-09-04T01:00:00.000Z'),
    commercialAmendmentAppliedAt: new Date('2026-09-04T04:00:00.000Z'),
    sourceAdjustmentOrdinal: 2,
    predecessorAdjustment: {
      adjustmentNoteId: '88888888-8888-4888-8888-888888888888',
      sourceAdjustmentOrdinal: 1,
      documentNumber: 'AU-ADJ-00000002',
      issuedAt: new Date('2026-09-04T03:00:00.000Z'),
      documentFingerprint: 'f'.repeat(64),
      afterPricingFingerprint: 'c'.repeat(64),
    },
    documentNumber: 'AU-ADJ-00000003',
    sequenceValue: 3n,
    issuedAt: new Date('2026-09-04T05:00:00.000Z'),
    currency: 'AUD',
    beforeTaxMinor: 8_000n,
    beforeTotalMinor: 88_000n,
    afterTaxMinor: 7_000n,
    afterTotalMinor: 77_000n,
    sourceInvoiceFingerprint: 'a'.repeat(64),
    beforePricingFingerprint: 'b'.repeat(64),
    afterPricingFingerprint: '9'.repeat(64),
    issuerFingerprint: 'd'.repeat(64),
    recipientFingerprint: 'e'.repeat(64),
    issuer: {},
    recipient: {},
    supplierAbn: '51824753556',
  }), /before-price fingerprint must equal the predecessor after-price fingerprint/);
});

test('rejects a commercial amendment applied before its predecessor adjustment note was issued', () => {
  assert.throws(() => createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot({
    ...ids,
    commercialAmendmentId: '66666666-6666-4666-8666-666666666666',
    targetPricingEvidenceId: '77777777-7777-4777-8777-777777777777',
    sourceInvoiceDocumentNumber: 'AU-TAX-00000001',
    sourceInvoiceIssuedAt: new Date('2026-09-04T01:00:00.000Z'),
    commercialAmendmentAppliedAt: new Date('2026-09-04T02:59:59.000Z'),
    sourceAdjustmentOrdinal: 2,
    predecessorAdjustment: {
      adjustmentNoteId: '88888888-8888-4888-8888-888888888888',
      sourceAdjustmentOrdinal: 1,
      documentNumber: 'AU-ADJ-00000002',
      issuedAt: new Date('2026-09-04T03:00:00.000Z'),
      documentFingerprint: 'f'.repeat(64),
      afterPricingFingerprint: 'c'.repeat(64),
    },
    documentNumber: 'AU-ADJ-00000003',
    sequenceValue: 3n,
    issuedAt: new Date('2026-09-04T05:00:00.000Z'),
    currency: 'AUD',
    beforeTaxMinor: 8_000n,
    beforeTotalMinor: 88_000n,
    afterTaxMinor: 7_000n,
    afterTotalMinor: 77_000n,
    sourceInvoiceFingerprint: 'a'.repeat(64),
    beforePricingFingerprint: 'c'.repeat(64),
    afterPricingFingerprint: '9'.repeat(64),
    issuerFingerprint: 'd'.repeat(64),
    recipientFingerprint: 'e'.repeat(64),
    issuer: {},
    recipient: {},
    supplierAbn: '51824753556',
  }), /cannot predate its predecessor adjustment note/);
});

test('rejects schema version 2 snapshots carrying hidden predecessor fields', () => {
  const snapshot = firstSnapshot();
  const tampered = {
    ...JSON.parse(JSON.stringify(snapshot)),
    predecessorAdjustmentNoteId: '88888888-8888-4888-8888-888888888888',
  };
  assert.throws(
    () => parseHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot(tampered),
    /cannot contain predecessor evidence/,
  );
});

test('rejects non-standard-GST before or after evidence', () => {
  const snapshot = firstSnapshot();
  assert.throws(() => createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot({
    ...ids,
    sourceInvoiceDocumentNumber: snapshot.sourceInvoiceDocumentNumber,
    sourceInvoiceIssuedAt: new Date(snapshot.sourceInvoiceIssuedAt),
    commercialAmendmentAppliedAt: new Date('2026-09-04T04:00:00.000Z'),
    sourceAdjustmentOrdinal: 1,
    documentNumber: 'AU-ADJ-00000003',
    sequenceValue: 3n,
    issuedAt: new Date('2026-09-04T05:00:00.000Z'),
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
