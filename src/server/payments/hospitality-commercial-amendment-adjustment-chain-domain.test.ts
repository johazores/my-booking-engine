import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HospitalityCommercialAmendmentAdjustmentChainIntegrityError,
  validateHospitalityCommercialAmendmentAdjustmentChain,
  type HospitalityCommercialAmendmentAdjustmentChainEntry,
} from './hospitality-commercial-amendment-adjustment-chain-domain.ts';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const BOOKING_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const SOURCE_ISSUED_AT = new Date('2026-09-01T00:00:00.000Z');
const ISSUER_FINGERPRINT = 'b'.repeat(64);
const RECIPIENT_FINGERPRINT = 'c'.repeat(64);
const SOURCE_DOCUMENT_FINGERPRINT = 'a'.repeat(64);

function fingerprint(character: string) {
  return character.repeat(64);
}

function price(totalMinor: bigint, pricingFingerprint: string) {
  const taxTotalMinor = totalMinor / 11n;
  return Object.freeze({
    currency: 'AUD',
    accommodationSubtotalMinor: totalMinor - taxTotalMinor,
    taxTotalMinor,
    feeTotalMinor: 0n,
    addonTotalMinor: 0n,
    totalMinor,
    pricingFingerprint,
  });
}

const SOURCE_PRICE = price(11_000n, fingerprint('1'));
const DECREASED_PRICE = price(9_900n, fingerprint('2'));
const INCREASED_PRICE = price(12_100n, fingerprint('3'));
const SECOND_INCREASED_PRICE = price(13_200n, fingerprint('4'));

const sourceInvoice = Object.freeze({
  id: SOURCE_ID,
  organizationId: ORGANIZATION_ID,
  bookingId: BOOKING_ID,
  documentNumber: 'AU-TAX-00000001',
  issuedAt: SOURCE_ISSUED_AT,
  documentFingerprint: SOURCE_DOCUMENT_FINGERPRINT,
  issuerFingerprint: ISSUER_FINGERPRINT,
  recipientFingerprint: RECIPIENT_FINGERPRINT,
  price: SOURCE_PRICE,
});

function entry(input: {
  id: string;
  ordinal: number;
  adjustmentType: 'DECREASING' | 'INCREASING';
  amendmentId: string;
  targetId: string;
  before: ReturnType<typeof price>;
  after: ReturnType<typeof price>;
  appliedAt: Date;
  issuedAt: Date;
  documentNumber: string;
  documentFingerprint: string;
  predecessor?: HospitalityCommercialAmendmentAdjustmentChainEntry;
}): HospitalityCommercialAmendmentAdjustmentChainEntry {
  const totalEffect = input.after.totalMinor - input.before.totalMinor;
  const taxEffect = input.after.taxTotalMinor - input.before.taxTotalMinor;
  const subtotalEffect = totalEffect - taxEffect;
  const predecessor = input.predecessor;
  const common = {
    kind: 'ADJUSTMENT_NOTE' as const,
    jurisdictionCode: 'AU' as const,
    adjustmentType: input.adjustmentType,
    adjustmentReason: 'COMMERCIAL_AMENDMENT' as const,
    organizationId: ORGANIZATION_ID,
    bookingId: BOOKING_ID,
    sourceInvoiceId: SOURCE_ID,
    sourceInvoiceDocumentNumber: sourceInvoice.documentNumber,
    sourceInvoiceIssuedAt: SOURCE_ISSUED_AT.toISOString(),
    commercialAmendmentId: input.amendmentId,
    commercialAmendmentAppliedAt: input.appliedAt.toISOString(),
    targetPricingEvidenceId: input.targetId,
    sourceAdjustmentOrdinal: String(input.ordinal),
    documentNumber: input.documentNumber,
    sequenceValue: String(input.ordinal),
    issuedAt: input.issuedAt.toISOString(),
    currency: 'AUD' as const,
    beforeTaxMinor: input.before.taxTotalMinor.toString(),
    beforeTotalMinor: input.before.totalMinor.toString(),
    afterTaxMinor: input.after.taxTotalMinor.toString(),
    afterTotalMinor: input.after.totalMinor.toString(),
    sourceInvoiceFingerprint: SOURCE_DOCUMENT_FINGERPRINT,
    beforePricingFingerprint: input.before.pricingFingerprint,
    afterPricingFingerprint: input.after.pricingFingerprint,
    issuerFingerprint: ISSUER_FINGERPRINT,
    recipientFingerprint: RECIPIENT_FINGERPRINT,
    issuer: Object.freeze({ legalName: 'Supplier' }),
    recipient: Object.freeze({ legalName: 'Customer' }),
    australianTax: Object.freeze({
      documentLabel: 'Adjustment note' as const,
      supplierAbn: '51824753556',
      adjustmentReasonLabel: 'Commercial booking amendment' as const,
      sourceTaxInvoiceNumber: sourceInvoice.documentNumber,
    }),
  };
  const predecessorFields = predecessor
    ? {
        predecessorAdjustmentNoteId: predecessor.id,
        predecessorAdjustmentDocumentNumber: predecessor.documentNumber,
        predecessorAdjustmentIssuedAt: predecessor.issuedAt.toISOString(),
        predecessorAdjustmentDocumentFingerprint: predecessor.documentFingerprint,
        predecessorAfterPricingFingerprint: predecessor.amendment.after.pricingFingerprint,
      }
    : {};
  const snapshot = input.adjustmentType === 'DECREASING'
    ? Object.freeze({
        schemaVersion: (input.ordinal === 1 ? 2 : 3) as 2 | 3,
        ...common,
        adjustmentType: 'DECREASING' as const,
        decreaseSubtotalMinor: (-subtotalEffect).toString(),
        decreaseTaxMinor: (-taxEffect).toString(),
        decreaseTotalMinor: (-totalEffect).toString(),
        ...predecessorFields,
      })
    : Object.freeze({
        schemaVersion: (input.ordinal === 1 ? 4 : 5) as 4 | 5,
        ...common,
        adjustmentType: 'INCREASING' as const,
        increaseSubtotalMinor: subtotalEffect.toString(),
        increaseTaxMinor: taxEffect.toString(),
        increaseTotalMinor: totalEffect.toString(),
        ...predecessorFields,
      });

  return Object.freeze({
    id: input.id,
    organizationId: ORGANIZATION_ID,
    bookingId: BOOKING_ID,
    sourceInvoiceId: SOURCE_ID,
    refundTransactionId: null,
    commercialAmendmentId: input.amendmentId,
    targetPricingEvidenceId: input.targetId,
    predecessorAdjustmentNoteId: predecessor?.id ?? null,
    predecessorSourceAdjustmentOrdinal: predecessor?.sourceAdjustmentOrdinal ?? null,
    sourceAdjustmentOrdinal: input.ordinal,
    jurisdictionCode: 'AU',
    documentType: 'ADJUSTMENT_NOTE',
    documentNumber: input.documentNumber,
    sequenceValue: BigInt(input.ordinal),
    issuedAt: input.issuedAt,
    currency: 'AUD',
    adjustmentType: input.adjustmentType,
    adjustmentReason: 'COMMERCIAL_AMENDMENT',
    decreaseSubtotalMinor: input.adjustmentType === 'DECREASING' ? -subtotalEffect : 0n,
    decreaseTaxMinor: input.adjustmentType === 'DECREASING' ? -taxEffect : 0n,
    decreaseTotalMinor: input.adjustmentType === 'DECREASING' ? -totalEffect : 0n,
    increaseSubtotalMinor: input.adjustmentType === 'INCREASING' ? subtotalEffect : 0n,
    increaseTaxMinor: input.adjustmentType === 'INCREASING' ? taxEffect : 0n,
    increaseTotalMinor: input.adjustmentType === 'INCREASING' ? totalEffect : 0n,
    sourceInvoiceFingerprint: SOURCE_DOCUMENT_FINGERPRINT,
    issuerFingerprint: ISSUER_FINGERPRINT,
    recipientFingerprint: RECIPIENT_FINGERPRINT,
    documentFingerprint: input.documentFingerprint,
    snapshot: snapshot as HospitalityCommercialAmendmentAdjustmentChainEntry['snapshot'],
    amendment: Object.freeze({
      id: input.amendmentId,
      organizationId: ORGANIZATION_ID,
      bookingId: BOOKING_ID,
      status: 'APPLIED',
      direction: input.adjustmentType === 'DECREASING' ? 'REFUND' : 'ADDITIONAL_CHARGE',
      appliedAt: input.appliedAt,
      deltaMinor: totalEffect,
      before: input.before,
      after: input.after,
    }),
    targetPricingEvidence: Object.freeze({
      id: input.targetId,
      organizationId: ORGANIZATION_ID,
      bookingId: BOOKING_ID,
      commercialAmendmentId: input.amendmentId,
      source: 'COMMERCIAL_AMENDMENT_TARGET',
      price: input.after,
      parsedPrice: input.after,
    }),
    settlement: Object.freeze({
      state: 'READY_TO_APPLY',
      settledAdjustmentMinor: totalEffect < 0n ? -totalEffect : totalEffect,
      remainingAdjustmentMinor: 0n,
      netSettledMinor: input.after.totalMinor,
    }),
  });
}

function firstDecrease() {
  return entry({
    id: '66666666-6666-4666-8666-666666666661',
    ordinal: 1,
    adjustmentType: 'DECREASING',
    amendmentId: '44444444-4444-4444-8444-444444444441',
    targetId: '55555555-5555-4555-8555-555555555551',
    before: SOURCE_PRICE,
    after: DECREASED_PRICE,
    appliedAt: new Date('2026-09-01T12:00:00.000Z'),
    issuedAt: new Date('2026-09-02T00:00:00.000Z'),
    documentNumber: 'AU-ADJ-00000001',
    documentFingerprint: fingerprint('d'),
  });
}

function firstIncrease() {
  return entry({
    id: '66666666-6666-4666-8666-666666666671',
    ordinal: 1,
    adjustmentType: 'INCREASING',
    amendmentId: '44444444-4444-4444-8444-444444444471',
    targetId: '55555555-5555-4555-8555-555555555571',
    before: SOURCE_PRICE,
    after: INCREASED_PRICE,
    appliedAt: new Date('2026-09-01T12:00:00.000Z'),
    issuedAt: new Date('2026-09-02T00:00:00.000Z'),
    documentNumber: 'AU-ADJ-00000011',
    documentFingerprint: fingerprint('e'),
  });
}

test('verifies a first increasing schema-version-4 commercial adjustment', () => {
  const result = validateHospitalityCommercialAmendmentAdjustmentChain({
    sourceInvoice,
    entries: [firstIncrease()],
  });
  assert.equal(result.priorAdjustmentNoteCount, 1);
  assert.equal(result.expectedSourceAdjustmentOrdinal, 2);
  assert.equal(result.head?.adjustmentType, 'INCREASING');
  assert.equal(result.head?.afterPricingFingerprint, INCREASED_PRICE.pricingFingerprint);
});

test('verifies a decreasing-to-increasing chain through schema version 5', () => {
  const first = firstDecrease();
  const second = entry({
    id: '66666666-6666-4666-8666-666666666662',
    ordinal: 2,
    adjustmentType: 'INCREASING',
    amendmentId: '44444444-4444-4444-8444-444444444442',
    targetId: '55555555-5555-4555-8555-555555555552',
    before: DECREASED_PRICE,
    after: INCREASED_PRICE,
    appliedAt: new Date('2026-09-02T12:00:00.000Z'),
    issuedAt: new Date('2026-09-03T00:00:00.000Z'),
    documentNumber: 'AU-ADJ-00000002',
    documentFingerprint: fingerprint('f'),
    predecessor: first,
  });
  const result = validateHospitalityCommercialAmendmentAdjustmentChain({
    sourceInvoice,
    entries: [first, second],
  });
  assert.equal(result.priorAdjustmentNoteCount, 2);
  assert.equal(result.head?.adjustmentType, 'INCREASING');
  assert.equal(result.priorAdjustments[1]?.before.totalMinor, DECREASED_PRICE.totalMinor);
  assert.equal(result.priorAdjustments[1]?.after.totalMinor, INCREASED_PRICE.totalMinor);
});

test('verifies an increasing-to-increasing repeated chain', () => {
  const first = firstIncrease();
  const second = entry({
    id: '66666666-6666-4666-8666-666666666672',
    ordinal: 2,
    adjustmentType: 'INCREASING',
    amendmentId: '44444444-4444-4444-8444-444444444472',
    targetId: '55555555-5555-4555-8555-555555555572',
    before: INCREASED_PRICE,
    after: SECOND_INCREASED_PRICE,
    appliedAt: new Date('2026-09-02T12:00:00.000Z'),
    issuedAt: new Date('2026-09-03T00:00:00.000Z'),
    documentNumber: 'AU-ADJ-00000012',
    documentFingerprint: fingerprint('6'),
    predecessor: first,
  });
  const result = validateHospitalityCommercialAmendmentAdjustmentChain({
    sourceInvoice,
    entries: [first, second],
  });
  assert.equal(result.expectedSourceAdjustmentOrdinal, 3);
  assert.equal(result.head?.afterPricingFingerprint, SECOND_INCREASED_PRICE.pricingFingerprint);
});

test('verifies an increasing-to-decreasing mixed-direction read chain', () => {
  const first = firstIncrease();
  const second = entry({
    id: '66666666-6666-4666-8666-666666666673',
    ordinal: 2,
    adjustmentType: 'DECREASING',
    amendmentId: '44444444-4444-4444-8444-444444444473',
    targetId: '55555555-5555-4555-8555-555555555573',
    before: INCREASED_PRICE,
    after: SOURCE_PRICE,
    appliedAt: new Date('2026-09-02T12:00:00.000Z'),
    issuedAt: new Date('2026-09-03T00:00:00.000Z'),
    documentNumber: 'AU-ADJ-00000013',
    documentFingerprint: fingerprint('7'),
    predecessor: first,
  });
  const result = validateHospitalityCommercialAmendmentAdjustmentChain({
    sourceInvoice,
    entries: [first, second],
  });
  assert.equal(result.head?.adjustmentType, 'DECREASING');
  assert.equal(result.head?.afterPricingFingerprint, SOURCE_PRICE.pricingFingerprint);
});

test('rejects direction and schema-version mismatches', () => {
  const first = firstIncrease();
  const broken = Object.freeze({
    ...first,
    snapshot: Object.freeze({
      ...first.snapshot,
      schemaVersion: 2 as const,
    }) as HospitalityCommercialAmendmentAdjustmentChainEntry['snapshot'],
  });
  assert.throws(
    () => validateHospitalityCommercialAmendmentAdjustmentChain({ sourceInvoice, entries: [broken] }),
    /schema version/i,
  );
});

test('rejects a repeated predecessor fingerprint mismatch across directions', () => {
  const first = firstDecrease();
  const second = entry({
    id: '66666666-6666-4666-8666-666666666674',
    ordinal: 2,
    adjustmentType: 'INCREASING',
    amendmentId: '44444444-4444-4444-8444-444444444474',
    targetId: '55555555-5555-4555-8555-555555555574',
    before: DECREASED_PRICE,
    after: INCREASED_PRICE,
    appliedAt: new Date('2026-09-02T12:00:00.000Z'),
    issuedAt: new Date('2026-09-03T00:00:00.000Z'),
    documentNumber: 'AU-ADJ-00000014',
    documentFingerprint: fingerprint('8'),
    predecessor: first,
  });
  const broken = Object.freeze({
    ...second,
    snapshot: Object.freeze({
      ...second.snapshot,
      predecessorAdjustmentDocumentFingerprint: fingerprint('9'),
    }) as HospitalityCommercialAmendmentAdjustmentChainEntry['snapshot'],
  });
  assert.throws(
    () => validateHospitalityCommercialAmendmentAdjustmentChain({ sourceInvoice, entries: [first, broken] }),
    /predecessor authority/i,
  );
});

test('rejects settlement that no longer proves the amendment step', () => {
  const first = firstIncrease();
  const broken = Object.freeze({
    ...first,
    settlement: Object.freeze({
      ...first.settlement,
      state: 'CONFLICT',
      netSettledMinor: SOURCE_PRICE.totalMinor,
    }),
  });
  assert.throws(
    () => validateHospitalityCommercialAmendmentAdjustmentChain({ sourceInvoice, entries: [broken] }),
    /payment settlement/i,
  );
});

test('rejects mixed effect columns for an increasing adjustment', () => {
  const first = firstIncrease();
  const broken = Object.freeze({ ...first, decreaseTotalMinor: 1n });
  assert.throws(
    () => validateHospitalityCommercialAmendmentAdjustmentChain({ sourceInvoice, entries: [broken] }),
    /increasing commercial adjustment-note effect/i,
  );
});

test('rejects duplicated immutable document authority', () => {
  const first = firstDecrease();
  const second = entry({
    id: '66666666-6666-4666-8666-666666666675',
    ordinal: 2,
    adjustmentType: 'INCREASING',
    amendmentId: '44444444-4444-4444-8444-444444444475',
    targetId: '55555555-5555-4555-8555-555555555575',
    before: DECREASED_PRICE,
    after: INCREASED_PRICE,
    appliedAt: new Date('2026-09-02T12:00:00.000Z'),
    issuedAt: new Date('2026-09-03T00:00:00.000Z'),
    documentNumber: first.documentNumber,
    documentFingerprint: fingerprint('0'),
    predecessor: first,
  });
  assert.throws(
    () => validateHospitalityCommercialAmendmentAdjustmentChain({ sourceInvoice, entries: [first, second] }),
    HospitalityCommercialAmendmentAdjustmentChainIntegrityError,
  );
});

test('rejects target pricing parsed-evidence drift', () => {
  const first = firstDecrease();
  const broken = Object.freeze({
    ...first,
    targetPricingEvidence: Object.freeze({
      ...first.targetPricingEvidence,
      parsedPrice: INCREASED_PRICE,
    }),
  });
  assert.throws(
    () => validateHospitalityCommercialAmendmentAdjustmentChain({ sourceInvoice, entries: [broken] }),
    /target pricing evidence/i,
  );
});

test('rejects a repeated amendment applied before the predecessor document', () => {
  const first = firstDecrease();
  const second = entry({
    id: '66666666-6666-4666-8666-666666666676',
    ordinal: 2,
    adjustmentType: 'INCREASING',
    amendmentId: '44444444-4444-4444-8444-444444444476',
    targetId: '55555555-5555-4555-8555-555555555576',
    before: DECREASED_PRICE,
    after: INCREASED_PRICE,
    appliedAt: new Date('2026-09-01T23:00:00.000Z'),
    issuedAt: new Date('2026-09-03T00:00:00.000Z'),
    documentNumber: 'AU-ADJ-00000016',
    documentFingerprint: fingerprint('5'),
    predecessor: first,
  });
  assert.throws(
    () => validateHospitalityCommercialAmendmentAdjustmentChain({ sourceInvoice, entries: [first, second] }),
    /chronology/i,
  );
});
