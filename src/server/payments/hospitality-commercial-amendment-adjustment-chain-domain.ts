import type {
  AustralianCommercialAmendmentAdjustmentPrice,
  AustralianCommercialAmendmentPriorAdjustment,
} from './hospitality-commercial-amendment-adjustment-domain.ts';

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

type VerifiedCommercialAdjustmentSnapshotBase = Readonly<{
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  sourceInvoiceDocumentNumber: string;
  sourceInvoiceIssuedAt: string;
  commercialAmendmentId: string;
  commercialAmendmentAppliedAt: string;
  targetPricingEvidenceId: string;
  sourceAdjustmentOrdinal: string;
  documentNumber: string;
  sequenceValue: string;
  issuedAt: string;
  currency: string;
  beforeTaxMinor: string;
  beforeTotalMinor: string;
  afterTaxMinor: string;
  afterTotalMinor: string;
  decreaseSubtotalMinor: string;
  decreaseTaxMinor: string;
  decreaseTotalMinor: string;
  sourceInvoiceFingerprint: string;
  beforePricingFingerprint: string;
  afterPricingFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
}>;

type VerifiedCommercialAdjustmentSnapshot =
  | (VerifiedCommercialAdjustmentSnapshotBase & Readonly<{ schemaVersion: 2 }>)
  | (VerifiedCommercialAdjustmentSnapshotBase & Readonly<{
      schemaVersion: 3;
      predecessorAdjustmentNoteId: string;
      predecessorAdjustmentDocumentNumber: string;
      predecessorAdjustmentIssuedAt: string;
      predecessorAdjustmentDocumentFingerprint: string;
      predecessorAfterPricingFingerprint: string;
    }>);

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
  adjustmentReason: string;
  decreaseSubtotalMinor: bigint;
  decreaseTaxMinor: bigint;
  decreaseTotalMinor: bigint;
  sourceInvoiceFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  documentFingerprint: string;
  snapshot: VerifiedCommercialAdjustmentSnapshot;
  amendment: CommercialAmendmentAuthority;
  targetPricingEvidence: TargetPricingAuthority;
}>;

function fail(message: string): never {
  throw new HospitalityCommercialAmendmentAdjustmentChainIntegrityError(message);
}

function normalizedCurrency(value: string) {
  return value.trim().toUpperCase();
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
    && left.pricingFingerprint.trim().toLowerCase() === right.pricingFingerprint.trim().toLowerCase()
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
    && /^[a-f0-9]{64}$/.test(price.pricingFingerprint.trim().toLowerCase())
  );
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
  ) {
    fail('Commercial adjustment-note row is outside the verified tenant/source chain.');
  }

  if (expectedOrdinal === 1) {
    if (
      entry.predecessorAdjustmentNoteId !== null
      || entry.predecessorSourceAdjustmentOrdinal !== null
      || snapshot.schemaVersion !== 2
    ) {
      fail('The first commercial adjustment-note row cannot declare predecessor authority.');
    }
  } else {
    if (!previous || snapshot.schemaVersion !== 3) {
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
        !== previous.amendment.after.pricingFingerprint.trim().toLowerCase()
    ) {
      fail('Repeated commercial adjustment-note predecessor authority does not match the verified chain head.');
    }
  }

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
    || BigInt(snapshot.decreaseSubtotalMinor) !== entry.decreaseSubtotalMinor
    || BigInt(snapshot.decreaseTaxMinor) !== entry.decreaseTaxMinor
    || BigInt(snapshot.decreaseTotalMinor) !== entry.decreaseTotalMinor
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
  if (
    amendment.id !== entry.commercialAmendmentId
    || amendment.organizationId !== source.organizationId
    || amendment.bookingId !== source.bookingId
    || amendment.status !== 'APPLIED'
    || amendment.direction !== 'REFUND'
    || !amendment.appliedAt
    || Number.isNaN(amendment.appliedAt.getTime())
    || amendment.appliedAt.getTime() !== new Date(snapshot.commercialAmendmentAppliedAt).getTime()
    || normalizedCurrency(amendment.before.currency) !== 'AUD'
    || normalizedCurrency(amendment.after.currency) !== 'AUD'
    || amendment.deltaMinor !== amendment.after.totalMinor - amendment.before.totalMinor
    || amendment.deltaMinor >= 0n
    || !standardGstPrice(amendment.before)
    || !standardGstPrice(amendment.after)
    || amendment.before.taxTotalMinor !== BigInt(snapshot.beforeTaxMinor)
    || amendment.before.totalMinor !== BigInt(snapshot.beforeTotalMinor)
    || amendment.after.taxTotalMinor !== BigInt(snapshot.afterTaxMinor)
    || amendment.after.totalMinor !== BigInt(snapshot.afterTotalMinor)
    || amendment.before.pricingFingerprint.trim().toLowerCase() !== snapshot.beforePricingFingerprint
    || amendment.after.pricingFingerprint.trim().toLowerCase() !== snapshot.afterPricingFingerprint
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

  const decreaseTotalMinor = amendment.before.totalMinor - amendment.after.totalMinor;
  const decreaseTaxMinor = amendment.before.taxTotalMinor - amendment.after.taxTotalMinor;
  const decreaseSubtotalMinor = decreaseTotalMinor - decreaseTaxMinor;
  if (
    decreaseTotalMinor <= 0n
    || decreaseTaxMinor <= 0n
    || decreaseSubtotalMinor <= 0n
    || decreaseTaxMinor * 11n !== decreaseTotalMinor
    || entry.decreaseSubtotalMinor !== decreaseSubtotalMinor
    || entry.decreaseTaxMinor !== decreaseTaxMinor
    || entry.decreaseTotalMinor !== decreaseTotalMinor
  ) {
    fail('Commercial adjustment-note decrease does not reconcile to exact standard GST.');
  }

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
  const priorAdjustments: AustralianCommercialAmendmentPriorAdjustment[] = [];
  let previous: HospitalityCommercialAmendmentAdjustmentChainEntry | null = null;
  let previousAfter: AustralianCommercialAmendmentAdjustmentPrice | null = null;

  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index]!;
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
          documentNumber: head.documentNumber,
          issuedAt: head.issuedAt,
          documentFingerprint: head.documentFingerprint,
          afterPricingFingerprint: head.amendment.after.pricingFingerprint.trim().toLowerCase(),
        })
      : null,
  });
}
