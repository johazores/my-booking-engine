import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessAustralianCommercialAmendmentAdjustmentReadiness,
  type AustralianCommercialAmendmentAdjustmentPrice,
  type AustralianCommercialAmendmentPriorAdjustment,
} from './hospitality-commercial-amendment-adjustment-domain.ts';

function fingerprint(character: string) {
  return character.repeat(64);
}

function price(totalMinor: bigint, fingerprintCharacter: string): AustralianCommercialAmendmentAdjustmentPrice {
  const taxTotalMinor = totalMinor / 11n;
  return Object.freeze({
    currency: 'AUD',
    accommodationSubtotalMinor: totalMinor - taxTotalMinor,
    taxTotalMinor,
    feeTotalMinor: 0n,
    addonTotalMinor: 0n,
    totalMinor,
    pricingFingerprint: fingerprint(fingerprintCharacter),
  });
}

function priorAdjustment(input: {
  adjustmentNoteId: string;
  sourceAdjustmentOrdinal: number;
  issuedAt: string;
  documentNumber: string;
  documentFingerprintCharacter: string;
  before: AustralianCommercialAmendmentAdjustmentPrice;
  after: AustralianCommercialAmendmentAdjustmentPrice;
}): AustralianCommercialAmendmentPriorAdjustment {
  return Object.freeze({
    adjustmentNoteId: input.adjustmentNoteId,
    sourceAdjustmentOrdinal: input.sourceAdjustmentOrdinal,
    issuedAt: new Date(input.issuedAt),
    documentNumber: input.documentNumber,
    documentFingerprint: fingerprint(input.documentFingerprintCharacter),
    before: input.before,
    after: input.after,
  });
}

function assessDecrease(input: {
  source: AustralianCommercialAmendmentAdjustmentPrice;
  priorAdjustments: readonly AustralianCommercialAmendmentPriorAdjustment[];
  before: AustralianCommercialAmendmentAdjustmentPrice;
  after: AustralianCommercialAmendmentAdjustmentPrice;
  appliedAt?: string;
}) {
  const decreaseTotalMinor = input.before.totalMinor - input.after.totalMinor;
  return assessAustralianCommercialAmendmentAdjustmentReadiness({
    sourceInvoice: {
      ...input.source,
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    amendment: {
      status: 'APPLIED',
      direction: 'REFUND',
      appliedAt: new Date(input.appliedAt ?? '2026-01-05T00:00:00.000Z'),
      deltaMinor: -decreaseTotalMinor,
      before: input.before,
      after: input.after,
    },
    targetPricingEvidence: input.after,
    priorAdjustmentNoteCount: input.priorAdjustments.length,
    priorAdjustments: input.priorAdjustments,
    settlement: {
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: decreaseTotalMinor,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: input.after.totalMinor,
    },
  });
}

test('decreasing readiness accepts an increasing predecessor as the verified legal baseline', () => {
  const source = price(110_000n, 'a');
  const increased = price(132_000n, 'b');
  const decreased = price(121_000n, 'c');
  const prior = priorAdjustment({
    adjustmentNoteId: 'adjustment-increase-1',
    sourceAdjustmentOrdinal: 1,
    issuedAt: '2026-01-02T00:00:00.000Z',
    documentNumber: 'AU-ADJ-00000001',
    documentFingerprintCharacter: 'd',
    before: source,
    after: increased,
  });

  const result = assessDecrease({
    source,
    priorAdjustments: [prior],
    before: increased,
    after: decreased,
    appliedAt: '2026-01-03T00:00:00.000Z',
  });

  assert.equal(result.contentReady, true);
  assert.equal(result.expectedSourceAdjustmentOrdinal, 2);
  assert.equal(result.predecessorAdjustmentNoteId, prior.adjustmentNoteId);
  assert.equal(result.predecessorDocumentNumber, prior.documentNumber);
  assert.equal(result.decreaseTotalMinor, 11_000n);
  assert.deepEqual(result.requirements, []);
});

test('decreasing readiness accepts a verified decrease-to-increase-to-decrease chain', () => {
  const source = price(110_000n, 'a');
  const firstDecrease = price(99_000n, 'b');
  const increase = price(132_000n, 'c');
  const finalDecrease = price(121_000n, 'd');
  const priorAdjustments = [
    priorAdjustment({
      adjustmentNoteId: 'adjustment-decrease-1',
      sourceAdjustmentOrdinal: 1,
      issuedAt: '2026-01-02T00:00:00.000Z',
      documentNumber: 'AU-ADJ-00000001',
      documentFingerprintCharacter: 'e',
      before: source,
      after: firstDecrease,
    }),
    priorAdjustment({
      adjustmentNoteId: 'adjustment-increase-2',
      sourceAdjustmentOrdinal: 2,
      issuedAt: '2026-01-03T00:00:00.000Z',
      documentNumber: 'AU-ADJ-00000002',
      documentFingerprintCharacter: 'f',
      before: firstDecrease,
      after: increase,
    }),
  ] as const;

  const result = assessDecrease({
    source,
    priorAdjustments,
    before: increase,
    after: finalDecrease,
    appliedAt: '2026-01-04T00:00:00.000Z',
  });

  assert.equal(result.contentReady, true);
  assert.equal(result.expectedSourceAdjustmentOrdinal, 3);
  assert.equal(result.predecessorAdjustmentNoteId, 'adjustment-increase-2');
  assert.equal(result.predecessorDocumentNumber, 'AU-ADJ-00000002');
  assert.equal(result.decreaseTotalMinor, 11_000n);
});

test('decreasing readiness still rejects a malformed increasing predecessor effect', () => {
  const source = price(110_000n, 'a');
  const validIncrease = price(132_000n, 'b');
  const malformedIncrease = Object.freeze({
    ...validIncrease,
    accommodationSubtotalMinor: 119_999n,
    taxTotalMinor: 12_001n,
  });
  const finalDecrease = price(121_000n, 'c');
  const prior = priorAdjustment({
    adjustmentNoteId: 'adjustment-invalid-increase-1',
    sourceAdjustmentOrdinal: 1,
    issuedAt: '2026-01-02T00:00:00.000Z',
    documentNumber: 'AU-ADJ-00000001',
    documentFingerprintCharacter: 'd',
    before: source,
    after: malformedIncrease,
  });

  const result = assessDecrease({
    source,
    priorAdjustments: [prior],
    before: validIncrease,
    after: finalDecrease,
    appliedAt: '2026-01-03T00:00:00.000Z',
  });

  assert.equal(result.contentReady, false);
  assert.ok(result.requirements.some((entry) => entry.code === 'PRIOR_ADJUSTMENT_CHAIN_INVALID'));
});
