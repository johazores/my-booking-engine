import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectVerifiedHospitalityCommercialSettlementAuthorityGroups,
  type HospitalityCommercialSettlementReconciliationAuthority,
} from './hospitality-commercial-settlement-reconciliation-authority-domain.ts';

const bookingId = '11111111-1111-4111-8111-111111111111';
const sourceInvoiceId = '22222222-2222-4222-8222-222222222222';
const issue1 = new Date('2026-01-01T00:00:00.000Z');
const issue2 = new Date('2026-01-02T00:00:00.000Z');
const issue3 = new Date('2026-01-03T00:00:00.000Z');

function authority(input: {
  ordinal: number;
  amendmentId: string;
  targetId: string;
  issuedAt: Date;
  appliedAt: Date;
  before: string;
  after: string;
  beforeTotal: bigint;
  afterTotal: bigint;
}): HospitalityCommercialSettlementReconciliationAuthority {
  return Object.freeze({
    documentNumber: `AU-ADJ-${String(input.ordinal).padStart(8, '0')}`,
    bookingId,
    sourceInvoiceId,
    sourceAdjustmentOrdinal: input.ordinal,
    issuedAt: input.issuedAt,
    commercialAmendmentId: input.amendmentId,
    commercialAmendmentAppliedAt: input.appliedAt,
    targetPricingEvidenceId: input.targetId,
    beforePricingFingerprint: input.before,
    afterPricingFingerprint: input.after,
    adjustmentType: 'DECREASING',
    currency: 'AUD',
    beforeTotalMinor: input.beforeTotal,
    afterTotalMinor: input.afterTotal,
  });
}

const fingerprint1 = '1'.repeat(64);
const fingerprint2 = '2'.repeat(64);
const fingerprint3 = '3'.repeat(64);
const fingerprint4 = '4'.repeat(64);
const amendment1 = '33333333-3333-4333-8333-333333333331';
const amendment2 = '33333333-3333-4333-8333-333333333332';
const amendment3 = '33333333-3333-4333-8333-333333333333';
const target1 = '44444444-4444-4444-8444-444444444441';
const target2 = '44444444-4444-4444-8444-444444444442';
const target3 = '44444444-4444-4444-8444-444444444443';

const authorities = [
  authority({ ordinal: 1, amendmentId: amendment1, targetId: target1, issuedAt: issue1, appliedAt: issue1, before: fingerprint1, after: fingerprint2, beforeTotal: 11_000n, afterTotal: 9_900n }),
  authority({ ordinal: 2, amendmentId: amendment2, targetId: target2, issuedAt: issue2, appliedAt: issue2, before: fingerprint2, after: fingerprint3, beforeTotal: 9_900n, afterTotal: 8_800n }),
  authority({ ordinal: 3, amendmentId: amendment3, targetId: target3, issuedAt: issue3, appliedAt: issue3, before: fingerprint3, after: fingerprint4, beforeTotal: 8_800n, afterTotal: 7_700n }),
];

function amendments() {
  return authorities.map((item) => ({
    id: item.commercialAmendmentId,
    bookingId: item.bookingId,
    status: 'APPLIED',
    direction: 'REFUND',
    appliedAt: item.commercialAmendmentAppliedAt,
    currency: item.currency,
    beforeTotalMinor: item.beforeTotalMinor,
    afterTotalMinor: item.afterTotalMinor,
    deltaMinor: item.afterTotalMinor - item.beforeTotalMinor,
    beforePricingFingerprint: item.beforePricingFingerprint,
    afterPricingFingerprint: item.afterPricingFingerprint,
  }));
}

function targets() {
  return authorities.map((item) => ({
    id: item.targetPricingEvidenceId,
    bookingId: item.bookingId,
    commercialAmendmentId: item.commercialAmendmentId,
    source: 'COMMERCIAL_AMENDMENT_TARGET',
    currency: item.currency,
    totalMinor: item.afterTotalMinor,
    pricingFingerprint: item.afterPricingFingerprint,
  }));
}

test('accepts a complete contiguous commercial settlement authority chain', () => {
  const groups = selectVerifiedHospitalityCommercialSettlementAuthorityGroups({
    authorities,
    amendments: amendments(),
    targetPricingEvidence: targets(),
  });
  assert.equal(groups.get(`${bookingId}:${sourceInvoiceId}`)?.length, 3);
});

test('rejects the entire chain when one intermediate target evidence row is invalid', () => {
  const targetRows = targets();
  targetRows[1] = { ...targetRows[1]!, totalMinor: 123n };
  const groups = selectVerifiedHospitalityCommercialSettlementAuthorityGroups({ authorities, amendments: amendments(), targetPricingEvidence: targetRows });
  assert.equal(groups.size, 0);
});

test('rejects the entire chain when pricing fingerprint continuity is broken', () => {
  const broken = [...authorities];
  broken[2] = Object.freeze({ ...broken[2]!, beforePricingFingerprint: fingerprint1 });
  const groups = selectVerifiedHospitalityCommercialSettlementAuthorityGroups({ authorities: broken, amendments: amendments(), targetPricingEvidence: targets() });
  assert.equal(groups.size, 0);
});

test('rejects a chain when a later amendment predates its legal predecessor issue time', () => {
  const broken = [...authorities];
  broken[1] = Object.freeze({ ...broken[1]!, commercialAmendmentAppliedAt: new Date('2025-12-31T23:59:59.000Z') });
  const amendmentRows = amendments();
  amendmentRows[1] = { ...amendmentRows[1]!, appliedAt: broken[1]!.commercialAmendmentAppliedAt };
  const groups = selectVerifiedHospitalityCommercialSettlementAuthorityGroups({ authorities: broken, amendments: amendmentRows, targetPricingEvidence: targets() });
  assert.equal(groups.size, 0);
});

test('rejects duplicate amendment or target authority inside one source chain', () => {
  const duplicate = [...authorities];
  duplicate[1] = Object.freeze({ ...duplicate[1]!, commercialAmendmentId: amendment1, targetPricingEvidenceId: target1 });
  const groups = selectVerifiedHospitalityCommercialSettlementAuthorityGroups({ authorities: duplicate, amendments: amendments(), targetPricingEvidence: targets() });
  assert.equal(groups.size, 0);
});

test('keeps an unrelated valid source chain when another source chain is invalid', () => {
  const otherSource = '55555555-5555-4555-8555-555555555555';
  const otherAmendment = '66666666-6666-4666-8666-666666666666';
  const otherTarget = '77777777-7777-4777-8777-777777777777';
  const other = Object.freeze({
    ...authorities[0]!,
    sourceInvoiceId: otherSource,
    commercialAmendmentId: otherAmendment,
    targetPricingEvidenceId: otherTarget,
    documentNumber: 'AU-ADJ-00000099',
  });
  const invalidFirstChain = Object.freeze({ ...authorities[1]!, sourceAdjustmentOrdinal: 3 });
  const groups = selectVerifiedHospitalityCommercialSettlementAuthorityGroups({
    authorities: [authorities[0]!, invalidFirstChain, other],
    amendments: [
      ...amendments(),
      {
        id: otherAmendment,
        bookingId,
        status: 'APPLIED',
        direction: 'REFUND',
        appliedAt: other.commercialAmendmentAppliedAt,
        currency: 'AUD',
        beforeTotalMinor: other.beforeTotalMinor,
        afterTotalMinor: other.afterTotalMinor,
        deltaMinor: other.afterTotalMinor - other.beforeTotalMinor,
        beforePricingFingerprint: other.beforePricingFingerprint,
        afterPricingFingerprint: other.afterPricingFingerprint,
      },
    ],
    targetPricingEvidence: [
      ...targets(),
      {
        id: otherTarget,
        bookingId,
        commercialAmendmentId: otherAmendment,
        source: 'COMMERCIAL_AMENDMENT_TARGET',
        currency: 'AUD',
        totalMinor: other.afterTotalMinor,
        pricingFingerprint: other.afterPricingFingerprint,
      },
    ],
  });
  assert.equal(groups.size, 1);
  assert.equal(groups.get(`${bookingId}:${otherSource}`)?.length, 1);
});

test('accepts a mixed decreasing and increasing commercial chain when persistence matches each direction', () => {
  const increasingAmendment = '88888888-8888-4888-8888-888888888888';
  const increasingTarget = '99999999-9999-4999-8999-999999999999';
  const increasing = Object.freeze({
    ...authorities[1]!,
    commercialAmendmentId: increasingAmendment,
    targetPricingEvidenceId: increasingTarget,
    adjustmentType: 'INCREASING' as const,
    beforeTotalMinor: authorities[0]!.afterTotalMinor,
    afterTotalMinor: 11_000n,
    beforePricingFingerprint: authorities[0]!.afterPricingFingerprint,
    afterPricingFingerprint: fingerprint3,
  });
  const groups = selectVerifiedHospitalityCommercialSettlementAuthorityGroups({
    authorities: [authorities[0]!, increasing],
    amendments: [
      amendments()[0]!,
      {
        id: increasingAmendment,
        bookingId,
        status: 'APPLIED',
        direction: 'ADDITIONAL_CHARGE',
        appliedAt: increasing.commercialAmendmentAppliedAt,
        currency: 'AUD',
        beforeTotalMinor: increasing.beforeTotalMinor,
        afterTotalMinor: increasing.afterTotalMinor,
        deltaMinor: increasing.afterTotalMinor - increasing.beforeTotalMinor,
        beforePricingFingerprint: increasing.beforePricingFingerprint,
        afterPricingFingerprint: increasing.afterPricingFingerprint,
      },
    ],
    targetPricingEvidence: [
      targets()[0]!,
      {
        id: increasingTarget,
        bookingId,
        commercialAmendmentId: increasingAmendment,
        source: 'COMMERCIAL_AMENDMENT_TARGET',
        currency: 'AUD',
        totalMinor: increasing.afterTotalMinor,
        pricingFingerprint: increasing.afterPricingFingerprint,
      },
    ],
  });
  assert.equal(groups.get(`${bookingId}:${sourceInvoiceId}`)?.length, 2);
});
