import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessAustralianCommercialAmendmentAdjustmentReadiness,
  type AustralianCommercialAmendmentAdjustmentPrice,
  type AustralianCommercialAmendmentPriorAdjustment,
} from './hospitality-commercial-amendment-adjustment-domain.ts';

const fingerprintA = 'a'.repeat(64);
const fingerprintB = 'b'.repeat(64);
const fingerprintC = 'c'.repeat(64);
const fingerprintD = 'd'.repeat(64);

function price(totalMinor: bigint, fingerprint: string): AustralianCommercialAmendmentAdjustmentPrice {
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

function priorAdjustment(overrides: Partial<AustralianCommercialAmendmentPriorAdjustment> = {}): AustralianCommercialAmendmentPriorAdjustment {
  return {
    adjustmentNoteId: '11111111-1111-4111-8111-111111111111',
    sourceAdjustmentOrdinal: 1,
    issuedAt: new Date('2026-09-02T12:00:00.000Z'),
    documentNumber: 'AU-ADJ-00000001',
    documentFingerprint: fingerprintD,
    before: price(110_000n, fingerprintA),
    after: price(99_000n, fingerprintC),
    ...overrides,
  };
}

function assessment(overrides: Partial<Parameters<typeof assessAustralianCommercialAmendmentAdjustmentReadiness>[0]> = {}) {
  const before = price(110_000n, fingerprintA);
  const after = price(88_000n, fingerprintB);
  return assessAustralianCommercialAmendmentAdjustmentReadiness({
    sourceInvoice: { ...before, issuedAt: new Date('2026-09-01T00:00:00.000Z') },
    amendment: {
      status: 'APPLIED',
      direction: 'REFUND',
      appliedAt: new Date('2026-09-03T00:00:00.000Z'),
      deltaMinor: -22_000n,
      before,
      after,
    },
    targetPricingEvidence: after,
    priorAdjustmentNoteCount: 0,
    settlement: {
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: 22_000n,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: 88_000n,
    },
    ...overrides,
  });
}

test('accepts a first applied decreasing commercial amendment with exact GST and settlement evidence', () => {
  const result = assessment();
  assert.equal(result.contentReady, true);
  assert.deepEqual(result.requirements, []);
  assert.equal(result.decreaseSubtotalMinor, 20_000n);
  assert.equal(result.decreaseTaxMinor, 2_000n);
  assert.equal(result.decreaseTotalMinor, 22_000n);
  assert.equal(result.expectedSourceAdjustmentOrdinal, 1);
  assert.equal(result.predecessorAdjustmentNoteId, null);
});

test('accepts a repeated decrease only when the complete predecessor chain establishes the legal baseline', () => {
  const before = price(99_000n, fingerprintC);
  const after = price(88_000n, fingerprintB);
  const predecessor = priorAdjustment();
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
    priorAdjustmentNoteCount: 1,
    priorAdjustments: [predecessor],
    settlement: {
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: 11_000n,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: 88_000n,
    },
  });
  assert.equal(result.contentReady, true);
  assert.deepEqual(result.requirements, []);
  assert.equal(result.expectedSourceAdjustmentOrdinal, 2);
  assert.equal(result.predecessorAdjustmentNoteId, predecessor.adjustmentNoteId);
  assert.equal(result.predecessorDocumentNumber, predecessor.documentNumber);
  assert.equal(result.predecessorDocumentFingerprint, predecessor.documentFingerprint);
});

test('accepts a third decrease only when ordinals and baselines form one contiguous chain', () => {
  const first = priorAdjustment();
  const second: AustralianCommercialAmendmentPriorAdjustment = {
    adjustmentNoteId: '22222222-2222-4222-8222-222222222222',
    sourceAdjustmentOrdinal: 2,
    issuedAt: new Date('2026-09-03T12:00:00.000Z'),
    documentNumber: 'AU-ADJ-00000002',
    documentFingerprint: 'e'.repeat(64),
    before: price(99_000n, fingerprintC),
    after: price(88_000n, fingerprintB),
  };
  const before = price(88_000n, fingerprintB);
  const after = price(77_000n, 'f'.repeat(64));
  const result = assessment({
    amendment: {
      status: 'APPLIED',
      direction: 'REFUND',
      appliedAt: new Date('2026-09-04T00:00:00.000Z'),
      deltaMinor: -11_000n,
      before,
      after,
    },
    targetPricingEvidence: after,
    priorAdjustmentNoteCount: 2,
    priorAdjustments: [second, first],
    settlement: {
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: 11_000n,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: 77_000n,
    },
  });
  assert.equal(result.contentReady, true);
  assert.equal(result.expectedSourceAdjustmentOrdinal, 3);
  assert.equal(result.predecessorAdjustmentNoteId, second.adjustmentNoteId);
});

test('rejects an amendment whose source baseline differs from the tax invoice', () => {
  const before = price(99_000n, fingerprintC);
  const result = assessment({
    amendment: {
      status: 'APPLIED',
      direction: 'REFUND',
      appliedAt: new Date('2026-09-03T00:00:00.000Z'),
      deltaMinor: -11_000n,
      before,
      after: price(88_000n, fingerprintB),
    },
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'LEGAL_BASELINE_MISMATCH'));
});

test('rejects an additional-charge amendment', () => {
  const result = assessment({
    amendment: {
      status: 'APPLIED',
      direction: 'ADDITIONAL_CHARGE',
      appliedAt: new Date('2026-09-03T00:00:00.000Z'),
      deltaMinor: 22_000n,
      before: price(110_000n, fingerprintA),
      after: price(132_000n, fingerprintB),
    },
    targetPricingEvidence: price(132_000n, fingerprintB),
    settlement: {
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: 22_000n,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: 132_000n,
    },
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'AMENDMENT_DIRECTION_UNSUPPORTED'));
});

test('rejects an unapplied amendment and one applied before the source invoice', () => {
  const result = assessment({
    amendment: {
      status: 'PREPARED',
      direction: 'REFUND',
      appliedAt: new Date('2026-08-31T23:59:59.000Z'),
      deltaMinor: -22_000n,
      before: price(110_000n, fingerprintA),
      after: price(88_000n, fingerprintB),
    },
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'AMENDMENT_NOT_APPLIED'));
  assert.ok(result.requirements.some((entry) => entry.code === 'AMENDMENT_PREDATES_INVOICE'));
});

test('keeps repeated issuance closed when earlier adjustment evidence is not supplied', () => {
  const result = assessment({ priorAdjustmentNoteCount: 1 });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'PRIOR_ADJUSTMENT_EXISTS'));
  assert.equal(result.expectedSourceAdjustmentOrdinal, null);
});

test('rejects a predecessor count that does not match the supplied chain', () => {
  const result = assessment({
    priorAdjustmentNoteCount: 2,
    priorAdjustments: [priorAdjustment()],
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'PRIOR_ADJUSTMENT_CHAIN_INVALID'));
});

test('rejects a non-contiguous predecessor ordinal', () => {
  const result = assessment({
    priorAdjustmentNoteCount: 1,
    priorAdjustments: [priorAdjustment({ sourceAdjustmentOrdinal: 2 })],
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'PRIOR_ADJUSTMENT_CHAIN_INVALID'));
});

test('rejects a predecessor whose before-price does not continue from the source invoice', () => {
  const result = assessment({
    priorAdjustmentNoteCount: 1,
    priorAdjustments: [priorAdjustment({
      before: price(121_000n, '9'.repeat(64)),
    })],
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'PRIOR_ADJUSTMENT_CHAIN_INVALID'));
});

test('rejects duplicate predecessor document identity', () => {
  const first = priorAdjustment();
  const second = priorAdjustment({
    adjustmentNoteId: '22222222-2222-4222-8222-222222222222',
    sourceAdjustmentOrdinal: 2,
    issuedAt: new Date('2026-09-03T12:00:00.000Z'),
    before: price(99_000n, fingerprintC),
    after: price(88_000n, fingerprintB),
  });
  const result = assessment({
    priorAdjustmentNoteCount: 2,
    priorAdjustments: [first, second],
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'PRIOR_ADJUSTMENT_CHAIN_INVALID'));
});

test('rejects a new amendment applied before its predecessor adjustment note was issued', () => {
  const before = price(99_000n, fingerprintC);
  const after = price(88_000n, fingerprintB);
  const result = assessment({
    amendment: {
      status: 'APPLIED',
      direction: 'REFUND',
      appliedAt: new Date('2026-09-02T11:59:59.000Z'),
      deltaMinor: -11_000n,
      before,
      after,
    },
    targetPricingEvidence: after,
    priorAdjustmentNoteCount: 1,
    priorAdjustments: [priorAdjustment()],
    settlement: {
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: 11_000n,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: 88_000n,
    },
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'AMENDMENT_PREDATES_PRIOR_ADJUSTMENT'));
});

test('rejects target pricing evidence drift', () => {
  const result = assessment({ targetPricingEvidence: price(77_000n, fingerprintC) });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'TARGET_EVIDENCE_MISMATCH'));
});

test('rejects non-standard-GST target pricing', () => {
  const after = {
    ...price(88_000n, fingerprintB),
    taxTotalMinor: 7_999n,
    accommodationSubtotalMinor: 80_001n,
  };
  const result = assessment({
    amendment: {
      status: 'APPLIED',
      direction: 'REFUND',
      appliedAt: new Date('2026-09-03T00:00:00.000Z'),
      deltaMinor: -22_000n,
      before: price(110_000n, fingerprintA),
      after,
    },
    targetPricingEvidence: after,
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'STANDARD_GST_EVIDENCE_INCOMPLETE'));
});

test('rejects a predecessor chain containing non-standard-GST price evidence', () => {
  const badAfter = {
    ...price(99_000n, fingerprintC),
    taxTotalMinor: 8_999n,
    accommodationSubtotalMinor: 90_001n,
  };
  const result = assessment({
    priorAdjustmentNoteCount: 1,
    priorAdjustments: [priorAdjustment({ after: badAfter })],
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'PRIOR_ADJUSTMENT_CHAIN_INVALID'));
});

test('rejects incomplete or mismatched amendment refund settlement', () => {
  const result = assessment({
    settlement: {
      state: 'REQUIRES_EXECUTION',
      settledAdjustmentMinor: 11_000n,
      remainingAdjustmentMinor: 11_000n,
      netSettledMinor: 99_000n,
    },
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'SETTLEMENT_NOT_RECONCILED'));
});
