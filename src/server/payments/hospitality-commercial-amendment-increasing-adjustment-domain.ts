import type {
  AustralianCommercialAmendmentPriorAdjustment,
} from './hospitality-commercial-amendment-adjustment-domain.ts';

export const australianCommercialAmendmentIncreasingAdjustmentReadinessContract = Object.freeze({
  schemaVersion: 1 as const,
  jurisdictionCode: 'AU' as const,
  currency: 'AUD' as const,
  documentType: 'ADJUSTMENT_NOTE' as const,
  adjustmentType: 'INCREASING' as const,
  adjustmentReason: 'COMMERCIAL_AMENDMENT' as const,
  adjustmentReasonLabel: 'Commercial booking amendment' as const,
  supportedTaxability: 'FULLY_TAXABLE_STANDARD_GST' as const,
});

export type AustralianCommercialAmendmentIncreasingAdjustmentRequirementCode =
  | 'SOURCE_INVOICE_UNSUPPORTED'
  | 'AMENDMENT_NOT_APPLIED'
  | 'AMENDMENT_DIRECTION_UNSUPPORTED'
  | 'AMENDMENT_PREDATES_INVOICE'
  | 'AMENDMENT_PREDATES_PRIOR_ADJUSTMENT'
  | 'PRIOR_ADJUSTMENT_EXISTS'
  | 'PRIOR_ADJUSTMENT_CHAIN_INVALID'
  | 'LEGAL_BASELINE_MISMATCH'
  | 'TARGET_EVIDENCE_MISMATCH'
  | 'INCREASE_INVALID'
  | 'STANDARD_GST_EVIDENCE_INCOMPLETE'
  | 'SETTLEMENT_NOT_RECONCILED';

export type AustralianCommercialAmendmentIncreasingAdjustmentRequirement = Readonly<{
  code: AustralianCommercialAmendmentIncreasingAdjustmentRequirementCode;
  message: string;
}>;

export type AustralianCommercialAmendmentIncreasingAdjustmentPrice = Readonly<{
  currency: string;
  accommodationSubtotalMinor: bigint;
  taxTotalMinor: bigint;
  feeTotalMinor: bigint;
  addonTotalMinor: bigint;
  totalMinor: bigint;
  pricingFingerprint: string;
}>;

type SourceInvoice = AustralianCommercialAmendmentIncreasingAdjustmentPrice & Readonly<{
  issuedAt: Date;
}>;

type CommercialAmendment = Readonly<{
  status: string;
  direction: string;
  appliedAt: Date | null;
  deltaMinor: bigint;
  before: AustralianCommercialAmendmentIncreasingAdjustmentPrice;
  after: AustralianCommercialAmendmentIncreasingAdjustmentPrice;
}>;

type Settlement = Readonly<{
  state: string;
  settledAdjustmentMinor: bigint;
  remainingAdjustmentMinor: bigint;
  netSettledMinor: bigint;
}>;

function requirement(
  code: AustralianCommercialAmendmentIncreasingAdjustmentRequirementCode,
  message: string,
): AustralianCommercialAmendmentIncreasingAdjustmentRequirement {
  return Object.freeze({ code, message });
}

function normalizedCurrency(value: string) {
  return value.trim().toUpperCase();
}

function validFingerprint(value: string) {
  return /^[a-f0-9]{64}$/.test(value.trim().toLowerCase());
}

function validIdentifier(value: string) {
  return value.trim().length > 0;
}

function priceComponentsReconcile(price: AustralianCommercialAmendmentIncreasingAdjustmentPrice) {
  return (
    price.accommodationSubtotalMinor >= 0n
    && price.taxTotalMinor >= 0n
    && price.feeTotalMinor >= 0n
    && price.addonTotalMinor >= 0n
    && price.totalMinor >= 0n
    && price.totalMinor
      === price.accommodationSubtotalMinor
        + price.taxTotalMinor
        + price.feeTotalMinor
        + price.addonTotalMinor
  );
}

function standardGstPrice(price: AustralianCommercialAmendmentIncreasingAdjustmentPrice) {
  return (
    normalizedCurrency(price.currency) === 'AUD'
    && priceComponentsReconcile(price)
    && validFingerprint(price.pricingFingerprint)
    && price.taxTotalMinor * 11n === price.totalMinor
  );
}

function samePrice(
  left: AustralianCommercialAmendmentIncreasingAdjustmentPrice,
  right: AustralianCommercialAmendmentIncreasingAdjustmentPrice,
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

function standardGstAdjustmentEffect(
  before: AustralianCommercialAmendmentIncreasingAdjustmentPrice,
  after: AustralianCommercialAmendmentIncreasingAdjustmentPrice,
) {
  if (!standardGstPrice(before) || !standardGstPrice(after) || before.totalMinor === after.totalMinor) {
    return false;
  }

  const totalEffect = after.totalMinor - before.totalMinor;
  const taxEffect = after.taxTotalMinor - before.taxTotalMinor;
  return (
    totalEffect !== 0n
    && taxEffect !== 0n
    && (totalEffect > 0n) === (taxEffect > 0n)
    && taxEffect * 11n === totalEffect
  );
}

function resolveVerifiedPriorAdjustmentChain(input: {
  sourceInvoice: SourceInvoice;
  priorAdjustmentNoteCount: number;
  priorAdjustments?: readonly AustralianCommercialAmendmentPriorAdjustment[];
}) {
  if (!Number.isSafeInteger(input.priorAdjustmentNoteCount) || input.priorAdjustmentNoteCount < 0) {
    throw new RangeError('priorAdjustmentNoteCount must be a non-negative safe integer.');
  }

  if (input.priorAdjustmentNoteCount === 0) {
    if (input.priorAdjustments && input.priorAdjustments.length !== 0) {
      return Object.freeze({ valid: false as const, reason: 'COUNT_MISMATCH' as const });
    }
    return Object.freeze({
      valid: true as const,
      legalBaseline: input.sourceInvoice,
      expectedSourceAdjustmentOrdinal: 1,
      predecessorAdjustmentNoteId: null,
      predecessorDocumentNumber: null,
      predecessorDocumentFingerprint: null,
      predecessorIssuedAt: null,
    });
  }

  if (!input.priorAdjustments) {
    return Object.freeze({ valid: false as const, reason: 'EVIDENCE_NOT_SUPPLIED' as const });
  }
  if (input.priorAdjustments.length !== input.priorAdjustmentNoteCount) {
    return Object.freeze({ valid: false as const, reason: 'COUNT_MISMATCH' as const });
  }

  const ordered = [...input.priorAdjustments].sort(
    (left, right) => left.sourceAdjustmentOrdinal - right.sourceAdjustmentOrdinal,
  );
  const adjustmentIds = new Set<string>();
  const documentNumbers = new Set<string>();
  const documentFingerprints = new Set<string>();
  let expectedBefore: AustralianCommercialAmendmentIncreasingAdjustmentPrice = input.sourceInvoice;
  let earliestIssuedAt = input.sourceInvoice.issuedAt.getTime();

  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index]!;
    const expectedOrdinal = index + 1;
    const adjustmentNoteId = entry.adjustmentNoteId.trim();
    const documentNumber = entry.documentNumber.trim();
    const documentFingerprint = entry.documentFingerprint.trim().toLowerCase();
    const issuedAt = entry.issuedAt.getTime();

    if (
      entry.sourceAdjustmentOrdinal !== expectedOrdinal
      || !validIdentifier(adjustmentNoteId)
      || !validIdentifier(documentNumber)
      || !validFingerprint(documentFingerprint)
      || Number.isNaN(issuedAt)
      || issuedAt < earliestIssuedAt
      || adjustmentIds.has(adjustmentNoteId)
      || documentNumbers.has(documentNumber)
      || documentFingerprints.has(documentFingerprint)
      || !samePrice(expectedBefore, entry.before)
      || !standardGstAdjustmentEffect(entry.before, entry.after)
    ) {
      return Object.freeze({ valid: false as const, reason: 'CHAIN_INVALID' as const });
    }

    adjustmentIds.add(adjustmentNoteId);
    documentNumbers.add(documentNumber);
    documentFingerprints.add(documentFingerprint);
    expectedBefore = entry.after;
    earliestIssuedAt = issuedAt;
  }

  const predecessor = ordered[ordered.length - 1]!;
  return Object.freeze({
    valid: true as const,
    legalBaseline: predecessor.after,
    expectedSourceAdjustmentOrdinal: predecessor.sourceAdjustmentOrdinal + 1,
    predecessorAdjustmentNoteId: predecessor.adjustmentNoteId.trim(),
    predecessorDocumentNumber: predecessor.documentNumber.trim(),
    predecessorDocumentFingerprint: predecessor.documentFingerprint.trim().toLowerCase(),
    predecessorIssuedAt: predecessor.issuedAt,
  });
}

export function assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness(input: {
  sourceInvoice: SourceInvoice;
  amendment: CommercialAmendment;
  targetPricingEvidence: AustralianCommercialAmendmentIncreasingAdjustmentPrice;
  priorAdjustmentNoteCount: number;
  priorAdjustments?: readonly AustralianCommercialAmendmentPriorAdjustment[];
  settlement: Settlement;
}) {
  const requirements: AustralianCommercialAmendmentIncreasingAdjustmentRequirement[] = [];
  const source = input.sourceInvoice;
  const amendment = input.amendment;
  const target = input.targetPricingEvidence;

  if (!standardGstPrice(source) || source.totalMinor <= 0n || Number.isNaN(source.issuedAt.getTime())) {
    requirements.push(requirement(
      'SOURCE_INVOICE_UNSUPPORTED',
      'The source tax invoice does not satisfy the supported Australian standard-GST pricing-evidence contract.',
    ));
  }

  if (amendment.status !== 'APPLIED' || !amendment.appliedAt || Number.isNaN(amendment.appliedAt.getTime())) {
    requirements.push(requirement(
      'AMENDMENT_NOT_APPLIED',
      'An increasing commercial adjustment requires an applied commercial amendment.',
    ));
  }

  if (amendment.direction !== 'ADDITIONAL_CHARGE' || amendment.deltaMinor <= 0n) {
    requirements.push(requirement(
      'AMENDMENT_DIRECTION_UNSUPPORTED',
      'The increasing commercial-amendment contract accepts additional-charge amendments only.',
    ));
  }

  if (
    amendment.appliedAt
    && !Number.isNaN(amendment.appliedAt.getTime())
    && !Number.isNaN(source.issuedAt.getTime())
    && amendment.appliedAt.getTime() < source.issuedAt.getTime()
  ) {
    requirements.push(requirement(
      'AMENDMENT_PREDATES_INVOICE',
      'The commercial amendment cannot be adjustment authority for a tax invoice issued after it was applied.',
    ));
  }

  const priorChain = resolveVerifiedPriorAdjustmentChain({
    sourceInvoice: source,
    priorAdjustmentNoteCount: input.priorAdjustmentNoteCount,
    priorAdjustments: input.priorAdjustments,
  });
  if (priorChain.valid === false) {
    requirements.push(requirement(
      priorChain.reason === 'EVIDENCE_NOT_SUPPLIED' ? 'PRIOR_ADJUSTMENT_EXISTS' : 'PRIOR_ADJUSTMENT_CHAIN_INVALID',
      priorChain.reason === 'EVIDENCE_NOT_SUPPLIED'
        ? 'Earlier adjustment notes require a complete verified predecessor chain before another increasing legal adjustment can be assessed.'
        : 'The supplied predecessor adjustment-note chain is incomplete, non-contiguous, duplicated, chronologically invalid, or does not reconcile to the source invoice.',
    ));
  }

  if (
    priorChain.valid
    && amendment.appliedAt
    && priorChain.predecessorIssuedAt
    && !Number.isNaN(amendment.appliedAt.getTime())
    && amendment.appliedAt.getTime() < priorChain.predecessorIssuedAt.getTime()
  ) {
    requirements.push(requirement(
      'AMENDMENT_PREDATES_PRIOR_ADJUSTMENT',
      'The commercial amendment cannot predate the legal adjustment note whose after-price is its baseline.',
    ));
  }

  if (
    !priceComponentsReconcile(amendment.before)
    || !validFingerprint(amendment.before.pricingFingerprint)
    || (priorChain.valid && !samePrice(priorChain.legalBaseline, amendment.before))
  ) {
    requirements.push(requirement(
      'LEGAL_BASELINE_MISMATCH',
      priorChain.valid && priorChain.predecessorAdjustmentNoteId
        ? 'The commercial amendment before-price does not exactly match the verified predecessor adjustment-note after-price.'
        : 'The commercial amendment before-price does not exactly match the immutable source tax invoice.',
    ));
  }

  if (
    !priceComponentsReconcile(amendment.after)
    || !priceComponentsReconcile(target)
    || !validFingerprint(amendment.after.pricingFingerprint)
    || !validFingerprint(target.pricingFingerprint)
    || !samePrice(amendment.after, target)
  ) {
    requirements.push(requirement(
      'TARGET_EVIDENCE_MISMATCH',
      'The applied amendment target does not exactly match its immutable target pricing evidence.',
    ));
  }

  const increaseTotalMinor = amendment.after.totalMinor - amendment.before.totalMinor;
  const increaseTaxMinor = amendment.after.taxTotalMinor - amendment.before.taxTotalMinor;
  const beforeSubtotalMinor = amendment.before.totalMinor - amendment.before.taxTotalMinor;
  const afterSubtotalMinor = amendment.after.totalMinor - amendment.after.taxTotalMinor;
  const increaseSubtotalMinor = afterSubtotalMinor - beforeSubtotalMinor;

  if (
    increaseTotalMinor <= 0n
    || increaseTaxMinor <= 0n
    || increaseSubtotalMinor <= 0n
    || amendment.deltaMinor !== increaseTotalMinor
    || increaseSubtotalMinor + increaseTaxMinor !== increaseTotalMinor
  ) {
    requirements.push(requirement(
      'INCREASE_INVALID',
      'The applied commercial amendment does not contain one exact increasing price adjustment.',
    ));
  }

  if (
    !standardGstPrice(amendment.before)
    || !standardGstPrice(amendment.after)
    || !standardGstPrice(target)
    || increaseTaxMinor * 11n !== increaseTotalMinor
  ) {
    requirements.push(requirement(
      'STANDARD_GST_EVIDENCE_INCOMPLETE',
      'The supported increasing-adjustment contract requires fully taxable standard-GST pricing before and after the amendment.',
    ));
  }

  if (
    input.settlement.state !== 'READY_TO_APPLY'
    || input.settlement.remainingAdjustmentMinor !== 0n
    || input.settlement.settledAdjustmentMinor !== increaseTotalMinor
    || input.settlement.netSettledMinor !== amendment.after.totalMinor
  ) {
    requirements.push(requirement(
      'SETTLEMENT_NOT_RECONCILED',
      'Commercial-amendment additional-charge settlement must reconcile exactly to the applied target price.',
    ));
  }

  return Object.freeze({
    contract: australianCommercialAmendmentIncreasingAdjustmentReadinessContract,
    contentReady: requirements.length === 0,
    increaseSubtotalMinor,
    increaseTaxMinor,
    increaseTotalMinor,
    beforeTotalMinor: amendment.before.totalMinor,
    afterTotalMinor: amendment.after.totalMinor,
    expectedSourceAdjustmentOrdinal: priorChain.valid ? priorChain.expectedSourceAdjustmentOrdinal : null,
    predecessorAdjustmentNoteId: priorChain.valid ? priorChain.predecessorAdjustmentNoteId : null,
    predecessorDocumentNumber: priorChain.valid ? priorChain.predecessorDocumentNumber : null,
    predecessorDocumentFingerprint: priorChain.valid ? priorChain.predecessorDocumentFingerprint : null,
    requirements: Object.freeze(requirements),
  });
}