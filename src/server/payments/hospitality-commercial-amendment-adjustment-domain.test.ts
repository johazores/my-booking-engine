import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessAustralianCommercialAmendmentAdjustmentReadiness,
  type AustralianCommercialAmendmentAdjustmentPrice,
} from './hospitality-commercial-amendment-adjustment-domain.ts';

const fingerprintA = 'a'.repeat(64);
const fingerprintB = 'b'.repeat(64);

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

function assessment(overrides: Partial<Parameters<typeof assessAustralianCommercialAmendmentAdjustmentReadiness>[0]> = {}) {
  const before = price(110_000n, fingerprintA);
  const after = price(88_000n, fingerprintB);
  return assessAustralianCommercialAmendmentAdjustmentReadiness({
    sourceInvoice: { ...before, issuedAt: new Date('2026-09-01T00:00:00.000Z') },
    amendment: {
      status: 'APPLIED',
      direction: 'REFUND',
      appliedAt: new Date('2026-09-02T00:00:00.000Z'),
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
});

test('rejects an amendment whose source baseline differs from the tax invoice', () => {
  const before = price(99_000n, 'c'.repeat(64));
  const result = assessment({
    amendment: {
      status: 'APPLIED',
      direction: 'REFUND',
      appliedAt: new Date('2026-09-02T00:00:00.000Z'),
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
      appliedAt: new Date('2026-09-02T00:00:00.000Z'),
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

test('rejects a second legal adjustment against the same source invoice', () => {
  const result = assessment({ priorAdjustmentNoteCount: 1 });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'PRIOR_ADJUSTMENT_EXISTS'));
});

test('rejects target pricing evidence drift', () => {
  const result = assessment({ targetPricingEvidence: price(77_000n, 'c'.repeat(64)) });
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
      appliedAt: new Date('2026-09-02T00:00:00.000Z'),
      deltaMinor: -22_000n,
      before: price(110_000n, fingerprintA),
      after,
    },
    targetPricingEvidence: after,
  });
  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'STANDARD_GST_EVIDENCE_INCOMPLETE'));
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
