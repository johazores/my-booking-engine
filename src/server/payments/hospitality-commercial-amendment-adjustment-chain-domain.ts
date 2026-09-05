import type {
  AustralianCommercialAmendmentAdjustmentPrice,
  AustralianCommercialAmendmentPriorAdjustment,
} from './hospitality-commercial-amendment-adjustment-domain.ts';
import type {
  HospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-adjustment-note-domain.ts';
import type {
  HospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-increasing-adjustment-note-domain.ts';

export class HospitalityCommercialAmendmentAdjustmentChainIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityCommercialAmendmentAdjustmentChainIntegrityError';
  }
}

export type HospitalityCommercialAmendmentAdjustmentChainSourceInvoice = Readonly<{
  id: string;
  organizationId: string;
  bookingId: string;
  documentNumber: string;
  issuedAt: Date;
  documentFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  price: AustralianCommercialAmendmentAdjustmentPrice;
}>;

type CommercialAmendmentAuthority = Readonly<{
  id: string;
  organizationId: string;
  bookingId: string;
  status: string;
  direction: string;
  appliedAt: Date | null;
  deltaMinor: bigint;
  before: AustralianCommercialAmendmentAdjustmentPrice;
  after: AustralianCommercialAmendmentAdjustmentPrice;
}>;

type TargetPricingAuthority = Readonly<{
  id: string;
  organizationId: string;
  bookingId: string;
  commercialAmendmentId: string | null;
  source: string;
  price: AustralianCommercialAmendmentAdjustmentPrice;
  parsedPrice: AustralianCommercialAmendmentAdjustmentPrice;
}>;

type CommercialAmendmentSettlementAuthority = Readonly<{
  state: string;
  settledAdjustmentMinor: bigint;
  remainingAdjustmentMinor: bigint;
  netSettledMinor: bigint;
}>;

type VerifiedCommercialAdjustmentSnapshot =
  | HospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot
  | HospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot;

export type HospitalityCommercialAmendmentAdjustmentChainEntry = Readonly<{
  id: string;
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  refundTransactionId: string | null;
  commercialAmendmentId: string | null;
  targetPricingEvidenceId: string | null;
  predecessorAdjustmentNoteId: string | null;
  predecessorSourceAdjustmentOrdinal: number | null;
  sourceAdjustmentOrdinal: number;
  jurisdictionCode: string;
  documentType: string;
  documentNumber: string;
  sequenceValue: bigint;
  issuedAt: Date;
  currency: string;
  adjustmentType: string;
  adjustmentReason: string;
  decreaseSubtotalMinor: bigint;
  decreaseTaxMinor: bigint;
  decreaseTotalMinor: bigint;
  increaseSubtotalMinor: bigint;
  increaseTaxMinor: bigint;
  increaseTotalMinor: bigint;
  sourceInvoiceFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  documentFingerprint: string;
  snapshot: VerifiedCommercialAdjustmentSnapshot;
  amendment: CommercialAmendmentAuthority;
  targetPricingEvidence: TargetPricingAuthority;
  settlement: CommercialAmendmentSettlementAuthority;
}>;

function fail(message: string): never {
  throw new HospitalityCommercialAmendmentAdjustmentChainIntegrityError(message);
}

function normalizedCurrency(value: string) {
  return value.trim().toUpperCase();
}

function normalizedFingerprint(value: string) {
  return value.trim().toLowerCase();
}

function samePrice(
  left: AustralianCommercialAmendmentAdjustmentPrice,
  right: AustralianCommercialAmendmentAdjustmentPrice,
) {
  return (
    normalizedCurrency(left.currency) === normalizedCurrency(right.currency)
    && left.accommodationSubtotalMinor === right.accommodationSubtotalMinor
    && left.taxTotalMinor === right.taxTotalMinor
    && left.feeTotalMinor === right.feeTotalMinor
    && left.addonTotalMinor === right.addonTotalMinor
    && left.totalMinor === right.totalMinor
    && normalizedFingerprint(left.pricingFingerprint) === normalizedFingerprint(right.pricingFingerprint)
  );
}

function standardGstPrice(price: AustralianCommercialAmendmentAdjustmentPrice) {
  return (
    normalizedCurrency(price.currency) === 'AUD'
    && price.accommodationSubtotalMinor >= 0n
    && price.taxTotalMinor >= 0n
    && price.feeTotalMinor >= 0n
    && price.addonTotalMinor >= 0n
    && price.totalMinor
      === price.accommodationSubtotalMinor
        + price.taxTotalMinor
        + price.feeTotalMinor
        + price.addonTotalMinor
    && price.taxTotalMinor * 11n === price.totalMinor
    && /^[a-f0-9]{64}$/.test(normalizedFingerprint(price.pricingFingerprint))
  );
}

function expectedAmendmentDirection(adjustmentType: string) {
  if (adjustmentType === 'DECREASING') return 'REFUND';
  if (adjustmentType === 'INCREASING') return 'ADDITIONAL_CHARGE';
  fail('Commercial adjustment-note direction is unsupported.');
}

function snapshotSchemaMatchesDirectionAndOrdinal(
  snapshot: VerifiedCommercialAdjustmentSnapshot,
  adjustmentType: string,
  expectedOrdinal: number,
) {
  if (expectedOrdinal === 1) {
    return (
      (adjustmentType === 'DECREASING' && snapshot.schemaVersion === 2)
      || (adjustmentType === 'INCREASING' && snapshot.schemaVersion === 4)
    );
  }
  return (
    (adjustmentType === 'DECREASING' && snapshot.schemaVersion === 3)
    || (adjustmentType === 'INCREASING' && snapshot.schemaVersion === 5)
  );
}

function validatePredecessorAuthority(
  entry: HospitalityCommercialAmendmentAdjustmentChainEntry,
  previous: HospitalityCommercialAmendmentAdjustmentChainEntry | null,
  expectedOrdinal: number,
) {
  const snapshot = entry.snapshot;
  if (!snapshotSchemaMatchesDirectionAndOrdinal(snapshot, entry.adjustmentType, expectedOrdinal)) {
    fail('Commercial adjustment-note schema version does not match its direction and source ordinal.');
  }

  if (expectedOrdinal === 1) {
    if (
      previous
      || entry.predecessorAdjustmentNoteId !== null
      || entry.predecessorSourceAdjustmentOrdinal !== null
      || snapshot.schemaVersion === 3
      || snapshot.schemaVersion === 5
    ) {
      fail('The first commercial adjustment-note row cannot declare predecessor authority.');
    }
    return;
  }

  if (!previous || (snapshot.schemaVersion !== 3 && snapshot.schemaVersion !== 5)) {
    fail('Repeated commercial adjustment-note predecessor authority does not match the verified chain head.');
  }
  if (
    entry.predecessorAdjustmentNoteId !== previous.id
    || entry.predecessorSourceAdjustmentOrdinal !== expectedOrdinal - 1
    || snapshot.predecessorAdjustmentNoteId !== previous.id
    || snapshot.predecessorAdjustmentDocumentNumber !== previous.documentNumber
    || new Date(snapshot.predecessorAdjustmentIssuedAt).getTime() !== previous.issuedAt.getTime()
    || snapshot.predecessorAdjustmentDocumentFingerprint !== previous.documentFingerprint
    || snapshot.predecessorAfterPricingFingerprint
      !== normalizedFingerprint(previous.amendment.after.pricingFingerprint)
  ) {
    fail('Repeated commercial adjustment-note predecessor authority does not match the verified chain head.');
  }
}

function validateDirectionalEffect(
  entry: HospitalityCommercialAmendmentAdjustmentChainEntry,
  amendment: CommercialAmendmentAuthority,
) {
  const totalEffect = amendment.after.totalMinor - amendment.before.totalMinor;
  const taxEffect = amendment.after.taxTotalMinor - amendment.before.taxTotalMinor;
  const subtotalEffect = totalEffect - taxEffect;

  if (
    totalEffect === 0n
    || taxEffect === 0n
    || subtotalEffect === 0n
    || amendment.deltaMinor !== totalEffect
    || taxEffect * 11n !== totalEffect
  ) {
    fail('Commercial adjustment-note directional effect does not reconcile to exact standard GST.');
  }

  if (entry.adjustmentType === 'DECREASING') {
    if (
      totalEffect >= 0n
      || taxEffect >= 0n
      || subtotalEffect >= 0n
      || entry.increaseSubtotalMinor !== 0n
      || entry.increaseTaxMinor !== 0n
      || entry.increaseTotalMinor !== 0n
      || entry.decreaseSubtotalMinor !== -subtotalEffect
      || entry.decreaseTaxMinor !== -taxEffect
      || entry.decreaseTotalMinor !== -totalEffect
      || entry.snapshot.adjustmentType !== 'DECREASING'
      || BigInt(entry.snapshot.decreaseSubtotalMinor) !== entry.decreaseSubtotalMinor
      || BigInt(entry.snapshot.decreaseTaxMinor) !== entry.decreaseTaxMinor
      || BigInt(entry.snapshot.decreaseTotalMinor) !== entry.decreaseTotalMinor
    ) {
      fail('Decreasing commercial adjustment-note effect does not reconcile to immutable evidence.');
    }
    return;
  }

  if (entry.adjustmentType !== 'INCREASING' || entry.snapshot.adjustmentType !== 'INCREASING') {
    fail('Commercial adjustment-note direction is unsupported.');
  }
  if (
    totalEffect <= 0n
    || taxEffect <= 0n
    || subtotalEffect <= 0n
    || entry.decreaseSubtotalMinor !== 0n
    || entry.decreaseTaxMinor !== 0n
    || entry.decreaseTotalMinor !== 0n
    || entry.increaseSubtotalMinor !== subtotalEffect
    || entry.increaseTaxMinor !== taxEffect
    || entry.increaseTotalMinor !== totalEffect
    || BigInt(entry.snapshot.increaseSubtotalMinor) !== entry.increaseSubtotalMinor
    || BigInt(entry.snapshot.increaseTaxMinor) !== entry.increaseTaxMinor
    || BigInt(entry.snapshot.increaseTotalMinor) !== entry.increaseTotalMinor
  ) {
    fail('Increasing commercial adjustment-note effect does not reconcile to immutable evidence.');
  }
}

function validateSettlement(
  entry: HospitalityCommercialAmendmentAdjustmentChainEntry,
  amendment: CommercialAmendmentAuthority,
) {
  const requiredAdjustmentMinor = amendment.deltaMinor < 0n ? -amendment.deltaMinor : amendment.deltaMinor;
  if (
    entry.settlement.state !== 'READY_TO_APPLY'
    || entry.settlement.remainingAdjustmentMinor !== 0n
    || entry.settlement.settledAdjustmentMinor !== requiredAdjustmentMinor
    || entry.settlement.netSettledMinor !== amendment.after.totalMinor
  ) {
    fail('Commercial adjustment-note payment settlement does not reconcile to the immutable amendment step.');
  }
}

function validateEntryMaterial(
  source: HospitalityCommercialAmendmentAdjustmentChainSourceInvoice,
  entry: HospitalityCommercialAmendmentAdjustmentChainEntry,
  previous: HospitalityCommercialAmendmentAdjustmentChainEntry | null,
  previousAfter: AustralianCommercialAmendmentAdjustmentPrice | null,
  expectedOrdinal: number,
) {
  const snapshot = entry.snapshot;

  if (
    entry.organizationId !== source.organizationId
    || entry.bookingId !== source.bookingId
    || entry.sourceInvoiceId !== source.id
    || entry.jurisdictionCode !== 'AU'
    || entry.documentType !== 'ADJUSTMENT_NOTE'
    || entry.adjustmentReason !== 'COMMERCIAL_AMENDMENT'
    || entry.refundTransactionId !== null
    || entry.commercialAmendmentId === null
    || entry.targetPricingEvidenceId === null
    || entry.sourceAdjustmentOrdinal !== expectedOrdinal
    || snapshot.adjustmentReason !== 'COMMERCIAL_AMENDMENT'
    || snapshot.adjustmentType !== entry.adjustmentType
  ) {
    fail('Commercial adjustment-note row is outside the verified tenant/source chain.');
  }

  validatePredecessorAuthority(entry, previous, expectedOrdinal);

  if (
    snapshot.organizationId !== entry.organizationId
    || snapshot.bookingId !== entry.bookingId
    || snapshot.sourceInvoiceId !== entry.sourceInvoiceId
    || snapshot.sourceInvoiceDocumentNumber !== source.documentNumber
    || new Date(snapshot.sourceInvoiceIssuedAt).getTime() !== source.issuedAt.getTime()
    || snapshot.commercialAmendmentId !== entry.commercialAmendmentId
    || snapshot.targetPricingEvidenceId !== entry.targetPricingEvidenceId
    || snapshot.sourceAdjustmentOrdinal !== String(expectedOrdinal)
    || snapshot.documentNumber !== entry.documentNumber
    || BigInt(snapshot.sequenceValue) !== entry.sequenceValue
    || new Date(snapshot.issuedAt).getTime() !== entry.issuedAt.getTime()
    || snapshot.currency !== normalizedCurrency(entry.currency)
    || snapshot.sourceInvoiceFingerprint !== entry.sourceInvoiceFingerprint
    || snapshot.sourceInvoiceFingerprint !== source.documentFingerprint
    || snapshot.issuerFingerprint !== entry.issuerFingerprint
    || snapshot.issuerFingerprint !== source.issuerFingerprint
    || snapshot.recipientFingerprint !== entry.recipientFingerprint
    || snapshot.recipientFingerprint !== source.recipientFingerprint
  ) {
    fail('Commercial adjustment-note row and immutable snapshot do not reconcile.');
  }

  const amendment = entry.amendment;
  const target = entry.targetPricingEvidence;
  const expectedDirection = expectedAmendmentDirection(entry.adjustmentType);
  if (
    amendment.id !== entry.commercialAmendmentId
    || amendment.organizationId !== source.organizationId
    || amendment.bookingId !== source.bookingId
    || amendment.status !== 'APPLIED'
    || amendment.direction !== expectedDirection
    || !amendment.appliedAt
    || Number.isNaN(amendment.appliedAt.getTime())
    || amendment.appliedAt.getTime() !== new Date(snapshot.commercialAmendmentAppliedAt).getTime()
    || !standardGstPrice(amendment.before)
    || !standardGstPrice(amendment.after)
    || amendment.before.taxTotalMinor !== BigInt(snapshot.beforeTaxMinor)
    || amendment.before.totalMinor !== BigInt(snapshot.beforeTotalMinor)
    || amendment.after.taxTotalMinor !== BigInt(snapshot.afterTaxMinor)
    || amendment.after.totalMinor !== BigInt(snapshot.afterTotalMinor)
    || normalizedFingerprint(amendment.before.pricingFingerprint) !== snapshot.beforePricingFingerprint
    || normalizedFingerprint(amendment.after.pricingFingerprint) !== snapshot.afterPricingFingerprint
  ) {
    fail('Commercial amendment authority does not reconcile to the immutable adjustment note.');
  }

  const legalBaseline = previousAfter ?? source.price;
  if (!samePrice(legalBaseline, amendment.before)) {
    fail('Commercial amendment before-price does not match the verified legal baseline.');
  }
  if (
    amendment.appliedAt.getTime() < source.issuedAt.getTime()
    || amendment.appliedAt.getTime() > entry.issuedAt.getTime()
    || (previous && amendment.appliedAt.getTime() < previous.issuedAt.getTime())
  ) {
    fail('Commercial adjustment-note authority chronology is invalid.');
  }

  if (
    target.id !== entry.targetPricingEvidenceId
    || target.organizationId !== source.organizationId
    || target.bookingId !== source.bookingId
    || target.commercialAmendmentId !== amendment.id
    || target.source !== 'COMMERCIAL_AMENDMENT_TARGET'
    || !samePrice(target.price, amendment.after)
    || !samePrice(target.parsedPrice, target.price)
  ) {
    fail('Commercial amendment target pricing evidence does not reconcile to the immutable authority.');
  }

  validateDirectionalEffect(entry, amendment);
  validateSettlement(entry, amendment);
  return Object.freeze({ snapshot, before: amendment.before, after: amendment.after });
}

export function validateHospitalityCommercialAmendmentAdjustmentChain(input: {
  sourceInvoice: HospitalityCommercialAmendmentAdjustmentChainSourceInvoice;
  entries: readonly HospitalityCommercialAmendmentAdjustmentChainEntry[];
}) {
  if (!standardGstPrice(input.sourceInvoice.price) || input.sourceInvoice.price.totalMinor <= 0n) {
    fail('Source tax-invoice price is outside the supported Australian standard-GST contract.');
  }
  if (Number.isNaN(input.sourceInvoice.issuedAt.getTime())) {
    fail('Source tax-invoice issue time is invalid.');
  }

  const ordered = [...input.entries].sort((left, right) => {
    if (left.sourceAdjustmentOrdinal !== right.sourceAdjustmentOrdinal) {
      return left.sourceAdjustmentOrdinal - right.sourceAdjustmentOrdinal;
    }
    return left.id.localeCompare(right.id);
  });
  const rowIds = new Set<string>();
  const amendmentIds = new Set<string>();
  const targetEvidenceIds = new Set<string>();
  const documentNumbers = new Set<string>();
  const documentFingerprints = new Set<string>();
  const sequenceValues = new Set<string>();
  const priorAdjustments: AustralianCommercialAmendmentPriorAdjustment[] = [];
  let previous: HospitalityCommercialAmendmentAdjustmentChainEntry | null = null;
  let previousAfter: AustralianCommercialAmendmentAdjustmentPrice | null = null;

  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index]!;
    if (
      rowIds.has(entry.id)
      || (entry.commercialAmendmentId !== null && amendmentIds.has(entry.commercialAmendmentId))
      || (entry.targetPricingEvidenceId !== null && targetEvidenceIds.has(entry.targetPricingEvidenceId))
      || documentNumbers.has(entry.documentNumber)
      || documentFingerprints.has(entry.documentFingerprint)
      || sequenceValues.has(entry.sequenceValue.toString())
    ) {
      fail('Commercial adjustment-note chain contains duplicated immutable authority.');
    }
    rowIds.add(entry.id);
    if (entry.commercialAmendmentId !== null) amendmentIds.add(entry.commercialAmendmentId);
    if (entry.targetPricingEvidenceId !== null) targetEvidenceIds.add(entry.targetPricingEvidenceId);
    documentNumbers.add(entry.documentNumber);
    documentFingerprints.add(entry.documentFingerprint);
    sequenceValues.add(entry.sequenceValue.toString());

    const expectedOrdinal = index + 1;
    const validated = validateEntryMaterial(
      input.sourceInvoice,
      entry,
      previous,
      previousAfter,
      expectedOrdinal,
    );
    priorAdjustments.push(Object.freeze({
      adjustmentNoteId: entry.id,
      sourceAdjustmentOrdinal: entry.sourceAdjustmentOrdinal,
      issuedAt: entry.issuedAt,
      documentNumber: entry.documentNumber,
      documentFingerprint: entry.documentFingerprint,
      before: validated.before,
      after: validated.after,
    }));
    previous = entry;
    previousAfter = validated.after;
  }

  const head = ordered.length === 0 ? null : ordered[ordered.length - 1]!;
  return Object.freeze({
    priorAdjustmentNoteCount: ordered.length,
    priorAdjustments: Object.freeze(priorAdjustments),
    expectedSourceAdjustmentOrdinal: ordered.length + 1,
    head: head
      ? Object.freeze({
          adjustmentNoteId: head.id,
          sourceAdjustmentOrdinal: head.sourceAdjustmentOrdinal,
          adjustmentType: head.adjustmentType as 'DECREASING' | 'INCREASING',
          documentNumber: head.documentNumber,
          issuedAt: head.issuedAt,
          documentFingerprint: head.documentFingerprint,
          afterPricingFingerprint: normalizedFingerprint(head.amendment.after.pricingFingerprint),
        })
      : null,
  });
}
