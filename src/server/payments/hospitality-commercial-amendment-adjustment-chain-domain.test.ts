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
const AMENDMENT_1_ID = '44444444-4444-4444-8444-444444444441';
const AMENDMENT_2_ID = '44444444-4444-4444-8444-444444444442';
const TARGET_1_ID = '55555555-5555-4555-8555-555555555551';
const TARGET_2_ID = '55555555-5555-4555-8555-555555555552';
const ADJUSTMENT_1_ID = '66666666-6666-4666-8666-666666666661';
const ADJUSTMENT_2_ID = '66666666-6666-4666-8666-666666666662';
const SOURCE_ISSUED_AT = new Date('2026-09-01T00:00:00.000Z');
const ADJUSTMENT_1_ISSUED_AT = new Date('2026-09-02T00:00:00.000Z');
const ADJUSTMENT_2_ISSUED_AT = new Date('2026-09-03T00:00:00.000Z');

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
const AFTER_1 = price(9_900n, fingerprint('2'));
const AFTER_2 = price(8_800n, fingerprint('3'));
const SOURCE_DOCUMENT_FINGERPRINT = fingerprint('a');
const ISSUER_FINGERPRINT = fingerprint('b');
const RECIPIENT_FINGERPRINT = fingerprint('c');

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
  amendmentId: string;
  targetId: string;
  before: ReturnType<typeof price>;
  after: ReturnType<typeof price>;
  issuedAt: Date;
  appliedAt: Date;
  documentNumber: string;
  documentFingerprint: string;
  predecessor?: HospitalityCommercialAmendmentAdjustmentChainEntry;
}): HospitalityCommercialAmendmentAdjustmentChainEntry {
  const decreaseTotalMinor = input.before.totalMinor - input.after.totalMinor;
  const decreaseTaxMinor = input.before.taxTotalMinor - input.after.taxTotalMinor;
  const decreaseSubtotalMinor = decreaseTotalMinor - decreaseTaxMinor;
  const predecessor = input.predecessor;
  const snapshot = Object.freeze({
    schemaVersion: (input.ordinal === 1 ? 2 : 3) as 2 | 3,
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
    currency: 'AUD',
    beforeTaxMinor: input.before.taxTotalMinor.toString(),
    beforeTotalMinor: input.before.totalMinor.toString(),
    afterTaxMinor: input.after.taxTotalMinor.toString(),
    afterTotalMinor: input.after.totalMinor.toString(),
    decreaseSubtotalMinor: decreaseSubtotalMinor.toString(),
    decreaseTaxMinor: decreaseTaxMinor.toString(),
    decreaseTotalMinor: decreaseTotalMinor.toString(),
    sourceInvoiceFingerprint: SOURCE_DOCUMENT_FINGERPRINT,
    beforePricingFingerprint: input.before.pricingFingerprint,
    afterPricingFingerprint: input.after.pricingFingerprint,
    issuerFingerprint: ISSUER_FINGERPRINT,
    recipientFingerprint: RECIPIENT_FINGERPRINT,
    ...(predecessor
      ? {
          predecessorAdjustmentNoteId: predecessor.id,
          predecessorAdjustmentDocumentNumber: predecessor.documentNumber,
          predecessorAdjustmentIssuedAt: predecessor.issuedAt.toISOString(),
          predecessorAdjustmentDocumentFingerprint: predecessor.documentFingerprint,
          predecessorAfterPricingFingerprint: predecessor.amendment.after.pricingFingerprint,
        }
      : {}),
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
    adjustmentReason: 'COMMERCIAL_AMENDMENT',
    decreaseSubtotalMinor,
    decreaseTaxMinor,
    decreaseTotalMinor,
    sourceInvoiceFingerprint: SOURCE_DOCUMENT_FINGERPRINT,
    issuerFingerprint: ISSUER_FINGERPRINT,
    recipientFingerprint: RECIPIENT_FINGERPRINT,
    documentFingerprint: input.documentFingerprint,
    snapshot,
    amendment: Object.freeze({
      id: input.amendmentId,
      organizationId: ORGANIZATION_ID,
      bookingId: BOOKING_ID,
      status: 'APPLIED',
      direction: 'REFUND',
      appliedAt: input.appliedAt,
      deltaMinor: input.after.totalMinor - input.before.totalMinor,
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
  });
}

function validChain() {
  const first = entry({
    id: ADJUSTMENT_1_ID,
    ordinal: 1,
    amendmentId: AMENDMENT_1_ID,
    targetId: TARGET_1_ID,
    before: SOURCE_PRICE,
    after: AFTER_1,
    appliedAt: new Date('2026-09-01T12:00:00.000Z'),
    issuedAt: ADJUSTMENT_1_ISSUED_AT,
    documentNumber: 'AU-ADJ-00000001',
    documentFingerprint: fingerprint('d'),
  });
  const second = entry({
    id: ADJUSTMENT_2_ID,
    ordinal: 2,
    amendmentId: AMENDMENT_2_ID,
    targetId: TARGET_2_ID,
    before: AFTER_1,
    after: AFTER_2,
    appliedAt: new Date('2026-09-02T12:00:00.000Z'),
    issuedAt: ADJUSTMENT_2_ISSUED_AT,
    documentNumber: 'AU-ADJ-00000002',
    documentFingerprint: fingerprint('e'),
    predecessor: first,
  });
  return [first, second] as const;
}

test('returns a verified linear chain head for two cumulative commercial adjustments', () => {
  const result = validateHospitalityCommercialAmendmentAdjustmentChain({
    sourceInvoice,
    entries: validChain(),
  });
  assert.equal(result.priorAdjustmentNoteCount, 2);
  assert.equal(result.expectedSourceAdjustmentOrdinal, 3);
  assert.equal(result.head?.adjustmentNoteId, ADJUSTMENT_2_ID);
  assert.equal(result.head?.afterPricingFingerprint, AFTER_2.pricingFingerprint);
  assert.equal(result.priorAdjustments[1]?.before.totalMinor, AFTER_1.totalMinor);
});

test('rejects a persisted predecessor pointer that does not match the immediate chain head', () => {
  const [first, second] = validChain();
  const broken = Object.freeze({ ...second, predecessorAdjustmentNoteId: ADJUSTMENT_1_ID.replace(/1$/, '9') });
  assert.throws(
    () => validateHospitalityCommercialAmendmentAdjustmentChain({ sourceInvoice, entries: [first, broken] }),
    HospitalityCommercialAmendmentAdjustmentChainIntegrityError,
  );
});

test('rejects immutable predecessor fingerprint drift in schema-version-3 evidence', () => {
  const [first, second] = validChain();
  const broken = Object.freeze({
    ...second,
    snapshot: Object.freeze({
      ...second.snapshot,
      predecessorAdjustmentDocumentFingerprint: fingerprint('f'),
    }),
  });
  assert.throws(
    () => validateHospitalityCommercialAmendmentAdjustmentChain({ sourceInvoice, entries: [first, broken] }),
    /predecessor authority/i,
  );
});

test('rejects target pricing evidence whose parsed immutable breakdown drifts from material columns', () => {
  const [first] = validChain();
  const broken = Object.freeze({
    ...first,
    targetPricingEvidence: Object.freeze({
      ...first.targetPricingEvidence,
      parsedPrice: AFTER_2,
    }),
  });
  assert.throws(
    () => validateHospitalityCommercialAmendmentAdjustmentChain({ sourceInvoice, entries: [broken] }),
    /target pricing evidence/i,
  );
});

test('rejects a second amendment whose before-price does not equal the verified predecessor after-price', () => {
  const [first, second] = validChain();
  const brokenBefore = price(9_350n, fingerprint('4'));
  const broken = Object.freeze({
    ...second,
    amendment: Object.freeze({
      ...second.amendment,
      before: brokenBefore,
      deltaMinor: second.amendment.after.totalMinor - brokenBefore.totalMinor,
    }),
  });
  assert.throws(
    () => validateHospitalityCommercialAmendmentAdjustmentChain({ sourceInvoice, entries: [first, broken] }),
    HospitalityCommercialAmendmentAdjustmentChainIntegrityError,
  );
});

test('rejects a repeated amendment applied before the predecessor legal document was issued', () => {
  const [first, second] = validChain();
  const appliedAt = new Date('2026-09-01T23:00:00.000Z');
  const broken = Object.freeze({
    ...second,
    snapshot: Object.freeze({ ...second.snapshot, commercialAmendmentAppliedAt: appliedAt.toISOString() }),
    amendment: Object.freeze({ ...second.amendment, appliedAt }),
  });
  assert.throws(
    () => validateHospitalityCommercialAmendmentAdjustmentChain({ sourceInvoice, entries: [first, broken] }),
    /chronology/i,
  );
});
