export const australianCommercialAmendmentAdjustmentReadinessContract = Object.freeze({
  schemaVersion: 1 as const,
  jurisdictionCode: 'AU' as const,
  currency: 'AUD' as const,
  documentType: 'ADJUSTMENT_NOTE' as const,
  adjustmentType: 'DECREASING' as const,
  adjustmentReason: 'COMMERCIAL_AMENDMENT' as const,
  adjustmentReasonLabel: 'Commercial booking amendment' as const,
  supportedTaxability: 'FULLY_TAXABLE_STANDARD_GST' as const,
});

export type AustralianCommercialAmendmentAdjustmentRequirementCode =
  | 'SOURCE_INVOICE_UNSUPPORTED'
  | 'AMENDMENT_NOT_APPLIED'
  | 'AMENDMENT_DIRECTION_UNSUPPORTED'
  | 'AMENDMENT_PREDATES_INVOICE'
  | 'PRIOR_ADJUSTMENT_EXISTS'
  | 'LEGAL_BASELINE_MISMATCH'
  | 'TARGET_EVIDENCE_MISMATCH'
  | 'DECREASE_INVALID'
  | 'STANDARD_GST_EVIDENCE_INCOMPLETE'
  | 'SETTLEMENT_NOT_RECONCILED';

export type AustralianCommercialAmendmentAdjustmentRequirement = Readonly<{
  code: AustralianCommercialAmendmentAdjustmentRequirementCode;
  message: string;
}>;

export type AustralianCommercialAmendmentAdjustmentPrice = Readonly<{
  currency: string;
  accommodationSubtotalMinor: bigint;
  taxTotalMinor: bigint;
  feeTotalMinor: bigint;
  addonTotalMinor: bigint;
  totalMinor: bigint;
  pricingFingerprint: string;
}>;

type SourceInvoice = AustralianCommercialAmendmentAdjustmentPrice & Readonly<{
  issuedAt: Date;
}>;

type CommercialAmendment = Readonly<{
  status: string;
  direction: string;
  appliedAt: Date | null;
  deltaMinor: bigint;
  before: AustralianCommercialAmendmentAdjustmentPrice;
  after: AustralianCommercialAmendmentAdjustmentPrice;
}>;

type Settlement = Readonly<{
  state: string;
  settledAdjustmentMinor: bigint;
  remainingAdjustmentMinor: bigint;
  netSettledMinor: bigint;
}>;

function requirement(
  code: AustralianCommercialAmendmentAdjustmentRequirementCode,
  message: string,
): AustralianCommercialAmendmentAdjustmentRequirement {
  return Object.freeze({ code, message });
}

function normalizedCurrency(value: string) {
  return value.trim().toUpperCase();
}

function validFingerprint(value: string) {
  return /^[a-f0-9]{64}$/.test(value.trim().toLowerCase());
}

function priceComponentsReconcile(price: AustralianCommercialAmendmentAdjustmentPrice) {
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

export function assessAustralianCommercialAmendmentAdjustmentReadiness(input: {
  sourceInvoice: SourceInvoice;
  amendment: CommercialAmendment;
  targetPricingEvidence: AustralianCommercialAmendmentAdjustmentPrice;
  priorAdjustmentNoteCount: number;
  settlement: Settlement;
}) {
  const requirements: AustralianCommercialAmendmentAdjustmentRequirement[] = [];
  const source = input.sourceInvoice;
  const amendment = input.amendment;
  const target = input.targetPricingEvidence;

  if (
    normalizedCurrency(source.currency) !== 'AUD'
    || !priceComponentsReconcile(source)
    || source.totalMinor <= 0n
    || !validFingerprint(source.pricingFingerprint)
    || Number.isNaN(source.issuedAt.getTime())
  ) {
    requirements.push(requirement(
      'SOURCE_INVOICE_UNSUPPORTED',
      'The source tax invoice does not satisfy the supported Australian pricing-evidence contract.',
    ));
  }

  if (amendment.status !== 'APPLIED' || !amendment.appliedAt || Number.isNaN(amendment.appliedAt.getTime())) {
    requirements.push(requirement(
      'AMENDMENT_NOT_APPLIED',
      'A commercial adjustment note requires an applied commercial amendment.',
    ));
  }

  if (amendment.direction !== 'REFUND' || amendment.deltaMinor >= 0n) {
    requirements.push(requirement(
      'AMENDMENT_DIRECTION_UNSUPPORTED',
      'The first commercial-amendment adjustment-note contract supports decreasing refund amendments only.',
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

  if (!Number.isSafeInteger(input.priorAdjustmentNoteCount) || input.priorAdjustmentNoteCount < 0) {
    throw new RangeError('priorAdjustmentNoteCount must be a non-negative safe integer.');
  }
  if (input.priorAdjustmentNoteCount !== 0) {
    requirements.push(requirement(
      'PRIOR_ADJUSTMENT_EXISTS',
      'The first commercial-amendment contract requires the source tax invoice to have no earlier adjustment note.',
    ));
  }

  if (
    !priceComponentsReconcile(amendment.before)
    || !validFingerprint(amendment.before.pricingFingerprint)
    || !samePrice(source, amendment.before)
  ) {
    requirements.push(requirement(
      'LEGAL_BASELINE_MISMATCH',
      'The commercial amendment before-price does not exactly match the immutable source tax invoice.',
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

  const decreaseTotalMinor = amendment.before.totalMinor - amendment.after.totalMinor;
  const decreaseTaxMinor = amendment.before.taxTotalMinor - amendment.after.taxTotalMinor;
  const beforeSubtotalMinor = amendment.before.totalMinor - amendment.before.taxTotalMinor;
  const afterSubtotalMinor = amendment.after.totalMinor - amendment.after.taxTotalMinor;
  const decreaseSubtotalMinor = beforeSubtotalMinor - afterSubtotalMinor;

  if (
    decreaseTotalMinor <= 0n
    || decreaseTaxMinor <= 0n
    || decreaseSubtotalMinor <= 0n
    || amendment.deltaMinor !== -decreaseTotalMinor
    || decreaseSubtotalMinor + decreaseTaxMinor !== decreaseTotalMinor
  ) {
    requirements.push(requirement(
      'DECREASE_INVALID',
      'The applied commercial amendment does not contain one exact decreasing price adjustment.',
    ));
  }

  if (
    normalizedCurrency(amendment.before.currency) !== 'AUD'
    || normalizedCurrency(amendment.after.currency) !== 'AUD'
    || normalizedCurrency(target.currency) !== 'AUD'
    || amendment.before.taxTotalMinor * 11n !== amendment.before.totalMinor
    || amendment.after.taxTotalMinor * 11n !== amendment.after.totalMinor
    || decreaseTaxMinor * 11n !== decreaseTotalMinor
  ) {
    requirements.push(requirement(
      'STANDARD_GST_EVIDENCE_INCOMPLETE',
      'The first commercial-amendment contract requires fully taxable standard-GST pricing before and after the adjustment.',
    ));
  }

  if (
    input.settlement.state !== 'READY_TO_APPLY'
    || input.settlement.remainingAdjustmentMinor !== 0n
    || input.settlement.settledAdjustmentMinor !== decreaseTotalMinor
    || input.settlement.netSettledMinor !== amendment.after.totalMinor
  ) {
    requirements.push(requirement(
      'SETTLEMENT_NOT_RECONCILED',
      'Commercial-amendment refund settlement must reconcile exactly to the applied target price.',
    ));
  }

  return Object.freeze({
    contract: australianCommercialAmendmentAdjustmentReadinessContract,
    contentReady: requirements.length === 0,
    decreaseSubtotalMinor,
    decreaseTaxMinor,
    decreaseTotalMinor,
    beforeTotalMinor: amendment.before.totalMinor,
    afterTotalMinor: amendment.after.totalMinor,
    requirements: Object.freeze(requirements),
  });
}
