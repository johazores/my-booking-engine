import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness,
  type AustralianCommercialAmendmentIncreasingAdjustmentPrice,
} from './hospitality-commercial-amendment-increasing-adjustment-domain.ts';

const fingerprintA = 'a'.repeat(64);
const fingerprintB = 'b'.repeat(64);
const fingerprintC = 'c'.repeat(64);
const fingerprintD = 'd'.repeat(64);
const fingerprintE = 'e'.repeat(64);

function price(totalMinor: bigint, fingerprint: string): AustralianCommercialAmendmentIncreasingAdjustmentPrice {
  const taxTotalMinor = totalMinor / 11n;
  return {
    currency: 'AUD',
    accommodationSubtotalMinor: totalMinor - taxTotalMinor,
    taxTotalMinor,
    feeTotalMinor: 0n,
    addonTotalMinor: 0n,
    totalMinor,
    pricingFingerprint: fingerprint,
  };
}

function assessment(overrides: Partial<Parameters<typeof assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness>[0]> = {}) {
  const before = price(110_000n, fingerprintA);
  const after = price(132_000n, fingerprintB);
  return assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness({
    sourceInvoice: { ...before, issuedAt: new Date('2026-09-01T00:00:00.000Z') },
    amendment: {
      status: 'APPLIED',
      direction: 'ADDITIONAL_CHARGE',
      appliedAt: new Date('2026-09-03T00:00:00.000Z'),
      deltaMinor: 22_000n,
      before,
      after,
    },
    targetPricingEvidence: after,
    priorAdjustmentNoteCount: 0,
    settlement: {
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: 22_000n,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: 132_000n,
    },
    ...overrides,
  });
}

test('accepts a first applied additional-charge amendment with exact GST and settlement evidence', () => {
  const result = assessment();
  assert.equal(result.contentReady, true);
  assert.deepEqual(result.requirements, []);
  assert.equal(result.increaseSubtotalMinor, 20_000n);
  assert.equal(result.increaseTaxMinor, 2_000n);
  assert.equal(result.increaseTotalMinor, 22_000n);
  assert.equal(result.expectedSourceAdjustmentOrdinal, 1);
  assert.equal(result.predecessorAdjustmentNoteId, null);
});

test('accepts a repeated increase after a verified decreasing predecessor', () => {
  const source = price(110_000n, fingerprintA);
  const decreased = price(99_000n, fingerprintB);
  const increased = price(121_000n, fingerprintC);
  const result = assessment({
    sourceInvoice: { ...source, issuedAt: new Date('2026-09-01T00:00:00.000Z') },
    amendment: {
      status: 'APPLIED',
      direction: 'ADDITIONAL_CHARGE',
      appliedAt: new Date('2026-09-04T00:00:00.000Z'),
      deltaMinor: 22_000n,
      before: decreased,
      after: increased,
    },
    targetPricingEvidence: increased,
    priorAdjustmentNoteCount: 1,
    priorAdjustments: [{
      adjustmentNoteId: 'adj-1',
      sourceAdjustmentOrdinal: 1,
      issuedAt: new Date('2026-09-03T00:00:00.000Z'),
      documentNumber: 'AU-ADJ-00000001',
      documentFingerprint: fingerprintD,
      before: source,
      after: decreased,
    }],
    settlement: {
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: 22_000n,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: 121_000n,
    },
  });
  assert.equal(result.contentReady, true);
  assert.equal(result.expectedSourceAdjustmentOrdinal, 2);
  assert.equal(result.predecessorAdjustmentNoteId, 'adj-1');
  assert.equal(result.predecessorDocumentNumber, 'AU-ADJ-00000001');
  assert.equal(result.predecessorDocumentFingerprint, fingerprintD);
});

test('accepts a repeated increase after a verified increasing predecessor', () => {
  const source = price(110_000n, fingerprintA);
  const firstIncrease = price(132_000n, fingerprintB);
  const secondIncrease = price(143_000n, fingerprintC);
  const result = assessment({
    sourceInvoice: { ...source, issuedAt: new Date('2026-09-01T00:00:00.000Z') },
    amendment: {
      status: 'APPLIED',
      direction: 'ADDITIONAL_CHARGE',
      appliedAt: new Date('2026-09-04T00:00:00.000Z'),
      deltaMinor: 11_000n,
      before: firstIncrease,
      after: secondIncrease,
    },
    targetPricingEvidence: secondIncrease,
    priorAdjustmentNoteCount: 1,
    priorAdjustments: [{
      adjustmentNoteId: 'adj-1',
      sourceAdjustmentOrdinal: 1,
      issuedAt: new Date('2026-09-03T00:00:00.000Z'),
      documentNumber: 'AU-ADJ-00000001',
      documentFingerprint: fingerprintD,
      before: source,
      after: firstIncrease,
    }],
    settlement: {
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: 11_000n,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: 143_000n,
    },
  });
  assert.equal(result.contentReady, true);
  assert.equal(result.expectedSourceAdjustmentOrdinal, 2);
});

test('keeps repeated issuance closed when predecessor evidence is missing or invalid', () => {
  const missing = assessment({ priorAdjustmentNoteCount: 1 });
  assert.equal(missing.contentReady, false);
  assert.equal(missing.expectedSourceAdjustmentOrdinal, null);
  assert.ok(missing.requirements.some((entry) => entry.code === 'PRIOR_ADJUSTMENT_EXISTS'));

  const source = price(110_000n, fingerprintA);
  const invalid = assessment({
    priorAdjustmentNoteCount: 1,
    priorAdjustments: [{
      adjustmentNoteId: 'adj-1',
      sourceAdjustmentOrdinal: 2,
      issuedAt: new Date('2026-09-03T00:00:00.000Z'),
      documentNumber: 'AU-ADJ-00000001',
      documentFingerprint: fingerprintD,
      before: source,
      after: price(99_000n, fingerprintB),
    }],
  });
  assert.equal(invalid.contentReady, false);
  assert.ok(invalid.requirements.some((entry) => entry.code === 'PRIOR_ADJUSTMENT_CHAIN_INVALID'));
});

test('rejects a repeated amendment whose before-price does not equal the verified chain head', () => {
  const source = price(110_000n, fingerprintA);
  const priorAfter = price(99_000n, fingerprintB);
  const wrongBefore = price(88_000n, fingerprintC);
  const after = price(110_000n, fingerprintE);
  const result = assessment({
    sourceInvoice: { ...source, issuedAt: new Date('2026-09-01T00:00:00.000Z') },
    amendment: {
      status: 'APPLIED',
      direction: 'ADDITIONAL_CHARGE',
      appliedAt: new Date('2026-09-04T00:00:00.000Z'),
      deltaMinor: 22_000n,
      before: wrongBefore,
      after,
    },
    targetPricingEvidence: after,
    priorAdjustmentNoteCount: 1,
    priorAdjustments: [{
      adjustmentNoteId: 'adj-1',
      sourceAdjustmentOrdinal: 1,
      issuedAt: new Date('2026-09-03T00:00:00.000Z'),
      documentNumber: 'AU-ADJ-00000001',
      documentFingerprint: fingerprintD,
      before: source,
      after: priorAfter,
    }],
    settlement: {
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: 22_000n,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: 110_000n,
    },
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'LEGAL_BASELINE_MISMATCH'));
});

test('rejects an amendment that predates the verified predecessor document', () => {
  const source = price(110_000n, fingerprintA);
  const priorAfter = price(99_000n, fingerprintB);
  const after = price(121_000n, fingerprintC);
  const result = assessment({
    sourceInvoice: { ...source, issuedAt: new Date('2026-09-01T00:00:00.000Z') },
    amendment: {
      status: 'APPLIED',
      direction: 'ADDITIONAL_CHARGE',
      appliedAt: new Date('2026-09-02T00:00:00.000Z'),
      deltaMinor: 22_000n,
      before: priorAfter,
      after,
    },
    targetPricingEvidence: after,
    priorAdjustmentNoteCount: 1,
    priorAdjustments: [{
      adjustmentNoteId: 'adj-1',
      sourceAdjustmentOrdinal: 1,
      issuedAt: new Date('2026-09-03T00:00:00.000Z'),
      documentNumber: 'AU-ADJ-00000001',
      documentFingerprint: fingerprintD,
      before: source,
      after: priorAfter,
    }],
    settlement: {
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: 22_000n,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: 121_000n,
    },
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'AMENDMENT_PREDATES_PRIOR_ADJUSTMENT'));
});

test('rejects refund direction', () => {
  const before = price(110_000n, fingerprintA);
  const after = price(99_000n, fingerprintB);
  const result = assessment({
    amendment: {
      status: 'APPLIED',
      direction: 'REFUND',
      appliedAt: new Date('2026-09-03T00:00:00.000Z'),
      deltaMinor: -11_000n,
      before,
      after,
    },
    targetPricingEvidence: after,
    settlement: {
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: 11_000n,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: 99_000n,
    },
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'AMENDMENT_DIRECTION_UNSUPPORTED'));
});

test('rejects source baseline drift for the first adjustment', () => {
  const before = price(99_000n, fingerprintC);
  const after = price(121_000n, fingerprintB);
  const result = assessment({
    amendment: {
      status: 'APPLIED',
      direction: 'ADDITIONAL_CHARGE',
      appliedAt: new Date('2026-09-03T00:00:00.000Z'),
      deltaMinor: 22_000n,
      before,
      after,
    },
    targetPricingEvidence: after,
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'LEGAL_BASELINE_MISMATCH'));
});

test('rejects target pricing evidence drift', () => {
  const result = assessment({ targetPricingEvidence: price(143_000n, fingerprintC) });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'TARGET_EVIDENCE_MISMATCH'));
});

test('rejects non-standard-GST target pricing', () => {
  const after = {
    ...price(132_000n, fingerprintB),
    taxTotalMinor: 11_999n,
    accommodationSubtotalMinor: 120_001n,
  };
  const result = assessment({
    amendment: {
      status: 'APPLIED',
      direction: 'ADDITIONAL_CHARGE',
      appliedAt: new Date('2026-09-03T00:00:00.000Z'),
      deltaMinor: 22_000n,
      before: price(110_000n, fingerprintA),
      after,
    },
    targetPricingEvidence: after,
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'STANDARD_GST_EVIDENCE_INCOMPLETE'));
});

test('rejects incomplete or mismatched additional-charge settlement', () => {
  const result = assessment({
    settlement: {
      state: 'REQUIRES_EXECUTION',
      settledAdjustmentMinor: 11_000n,
      remainingAdjustmentMinor: 11_000n,
      netSettledMinor: 121_000n,
    },
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'SETTLEMENT_NOT_RECONCILED'));
});

test('rejects unapplied or pre-invoice amendment authority', () => {
  const result = assessment({
    amendment: {
      status: 'PREPARED',
      direction: 'ADDITIONAL_CHARGE',
      appliedAt: new Date('2026-08-31T23:59:59.000Z'),
      deltaMinor: 22_000n,
      before: price(110_000n, fingerprintA),
      after: price(132_000n, fingerprintB),
    },
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'AMENDMENT_NOT_APPLIED'));
  assert.ok(result.requirements.some((entry) => entry.code === 'AMENDMENT_PREDATES_INVOICE'));
});

test('rejects an incorrect persisted positive delta even when totals are increasing', () => {
  const before = price(110_000n, fingerprintA);
  const after = price(132_000n, fingerprintB);
  const result = assessment({
    amendment: {
      status: 'APPLIED',
      direction: 'ADDITIONAL_CHARGE',
      appliedAt: new Date('2026-09-03T00:00:00.000Z'),
      deltaMinor: 11_000n,
      before,
      after,
    },
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'INCREASE_INVALID'));
});