import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot,
  hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint,
  parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-increasing-adjustment-note-domain.ts';

const ids = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  bookingId: '22222222-2222-4222-8222-222222222222',
  sourceInvoiceId: '33333333-3333-4333-8333-333333333333',
  commercialAmendmentId: '44444444-4444-4444-8444-444444444444',
  targetPricingEvidenceId: '55555555-5555-4555-8555-555555555555',
};

function snapshot(overrides: Record<string, unknown> = {}) {
  return createHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot({
    ...ids,
    sourceInvoiceDocumentNumber: 'AU-TAX-00000001',
    sourceInvoiceIssuedAt: new Date('2026-09-01T00:00:00.000Z'),
    commercialAmendmentAppliedAt: new Date('2026-09-03T00:00:00.000Z'),
    sourceAdjustmentOrdinal: 1,
    documentNumber: 'AU-ADJ-00000002',
    sequenceValue: 2n,
    issuedAt: new Date('2026-09-03T00:01:00.000Z'),
    currency: 'AUD',
    beforeTaxMinor: 10_000n,
    beforeTotalMinor: 110_000n,
    afterTaxMinor: 12_000n,
    afterTotalMinor: 132_000n,
    sourceInvoiceFingerprint: 'a'.repeat(64),
    beforePricingFingerprint: 'b'.repeat(64),
    afterPricingFingerprint: 'c'.repeat(64),
    issuerFingerprint: 'd'.repeat(64),
    recipientFingerprint: 'e'.repeat(64),
    issuer: { legalName: 'Example Hotel Pty Ltd' },
    recipient: { legalName: 'Example Guest' },
    supplierAbn: '51824753556',
    ...overrides,
  });
}

test('creates immutable schema-version-4 increasing adjustment evidence from exact standard GST', () => {
  const result = snapshot();
  assert.equal(result.schemaVersion, 4);
  assert.equal(result.adjustmentType, 'INCREASING');
  assert.equal(result.adjustmentReason, 'COMMERCIAL_AMENDMENT');
  assert.equal(result.sourceAdjustmentOrdinal, '1');
  assert.equal(result.increaseSubtotalMinor, '20000');
  assert.equal(result.increaseTaxMinor, '2000');
  assert.equal(result.increaseTotalMinor, '22000');
  assert.ok(Object.isFrozen(result));
});

test('round-trips through the strict parser with a stable canonical fingerprint', () => {
  const created = snapshot();
  const parsed = parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot(
    JSON.parse(JSON.stringify(created)),
  );
  assert.deepEqual(parsed, created);
  assert.equal(
    hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint(parsed),
    hospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteFingerprint(created),
  );
});

test('rejects decreasing or hidden predecessor authority in schema version 4', () => {
  const created = snapshot();
  assert.throws(() => parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot({
    ...created,
    adjustmentType: 'DECREASING',
  }));
  assert.throws(() => parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot({
    ...created,
    predecessorAdjustmentNoteId: '66666666-6666-4666-8666-666666666666',
  }));
  assert.throws(() => parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot({
    ...created,
    decreaseTotalMinor: '22000',
  }));
});

test('rejects repeated increasing ordinals until mixed/cumulative direction semantics are defined', () => {
  assert.throws(() => snapshot({ sourceAdjustmentOrdinal: 2 }));
});

test('rejects chronology that predates the source invoice or applied amendment', () => {
  assert.throws(() => snapshot({
    commercialAmendmentAppliedAt: new Date('2026-08-31T23:59:59.000Z'),
  }));
  assert.throws(() => snapshot({
    issuedAt: new Date('2026-09-02T23:59:59.000Z'),
  }));
});

test('rejects non-standard-GST or decreasing before/after money', () => {
  assert.throws(() => snapshot({
    afterTaxMinor: 11_999n,
    afterTotalMinor: 132_000n,
  }));
  assert.throws(() => snapshot({
    afterTaxMinor: 9_000n,
    afterTotalMinor: 99_000n,
  }));
});

test('rejects persisted effect fields that disagree with canonical before/after evidence', () => {
  const created = snapshot();
  assert.throws(() => parseHospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot({
    ...created,
    increaseTaxMinor: '1999',
  }));
});
