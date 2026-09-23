export type HospitalityCommercialSettlementReconciliationAuthority = Readonly<{
  documentNumber: string;
  bookingId: string;
  sourceInvoiceId: string;
  sourceInvoiceDocumentNumber: string;
  sourceInvoiceIssuedAt: Date;
  sourceInvoiceFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  sourceAdjustmentOrdinal: number;
  issuedAt: Date;
  commercialAmendmentId: string;
  commercialAmendmentAppliedAt: Date;
  targetPricingEvidenceId: string;
  beforePricingFingerprint: string;
  afterPricingFingerprint: string;
  adjustmentType: 'DECREASING' | 'INCREASING';
  currency: string;
  beforeTotalMinor: bigint;
  afterTotalMinor: bigint;
}>;

export type HospitalityCommercialSettlementReconciliationSourceInvoice = Readonly<{
  id: string;
  bookingId: string;
  documentNumber: string;
  issuedAt: Date;
  currency: string;
  totalMinor: bigint;
  pricingFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  documentFingerprint: string;
}>;

export type HospitalityCommercialSettlementReconciliationAmendment = Readonly<{
  id: string;
  bookingId: string;
  status: string;
  direction: string;
  appliedAt: Date | null;
  currency: string;
  beforeTotalMinor: bigint;
  afterTotalMinor: bigint;
  deltaMinor: bigint;
  beforePricingFingerprint: string;
  afterPricingFingerprint: string;
}>;

export type HospitalityCommercialSettlementReconciliationTargetEvidence = Readonly<{
  id: string;
  bookingId: string;
  commercialAmendmentId: string | null;
  source: string;
  currency: string;
  totalMinor: bigint;
  pricingFingerprint: string;
}>;

function authorityGroupKey(authority: HospitalityCommercialSettlementReconciliationAuthority) {
  return `${authority.bookingId}:${authority.sourceInvoiceId}`;
}

function sourceInvoiceMatchesAuthority(input: {
  authority: HospitalityCommercialSettlementReconciliationAuthority;
  sourceInvoice: HospitalityCommercialSettlementReconciliationSourceInvoice | undefined;
}) {
  const { authority, sourceInvoice } = input;
  return Boolean(
    sourceInvoice
    && sourceInvoice.bookingId === authority.bookingId
    && sourceInvoice.documentNumber === authority.sourceInvoiceDocumentNumber
    && sourceInvoice.issuedAt.getTime() === authority.sourceInvoiceIssuedAt.getTime()
    && sourceInvoice.currency === authority.currency
    && sourceInvoice.documentFingerprint === authority.sourceInvoiceFingerprint
    && sourceInvoice.issuerFingerprint === authority.issuerFingerprint
    && sourceInvoice.recipientFingerprint === authority.recipientFingerprint
    && sourceInvoice.issuedAt.getTime() <= authority.commercialAmendmentAppliedAt.getTime()
    && sourceInvoice.issuedAt.getTime() <= authority.issuedAt.getTime()
  );
}

function currentAuthorityMatchesPersistence(input: {
  authority: HospitalityCommercialSettlementReconciliationAuthority;
  amendment: HospitalityCommercialSettlementReconciliationAmendment | undefined;
  target: HospitalityCommercialSettlementReconciliationTargetEvidence | undefined;
}) {
  const { authority, amendment, target } = input;
  const expectedDirection = authority.adjustmentType === 'DECREASING' ? 'REFUND' : 'ADDITIONAL_CHARGE';
  return Boolean(
    amendment
    && target
    && amendment.bookingId === authority.bookingId
    && amendment.status === 'APPLIED'
    && amendment.appliedAt
    && amendment.appliedAt.getTime() === authority.commercialAmendmentAppliedAt.getTime()
    && amendment.appliedAt.getTime() <= authority.issuedAt.getTime()
    && amendment.direction === expectedDirection
    && amendment.currency === authority.currency
    && amendment.beforeTotalMinor === authority.beforeTotalMinor
    && amendment.afterTotalMinor === authority.afterTotalMinor
    && amendment.afterTotalMinor - amendment.beforeTotalMinor === amendment.deltaMinor
    && amendment.beforePricingFingerprint === authority.beforePricingFingerprint
    && amendment.afterPricingFingerprint === authority.afterPricingFingerprint
    && target.bookingId === authority.bookingId
    && target.commercialAmendmentId === authority.commercialAmendmentId
    && target.source === 'COMMERCIAL_AMENDMENT_TARGET'
    && target.currency === authority.currency
    && target.totalMinor === authority.afterTotalMinor
    && target.pricingFingerprint === authority.afterPricingFingerprint
  );
}

export function selectVerifiedHospitalityCommercialSettlementAuthorityGroups(input: {
  authorities: readonly HospitalityCommercialSettlementReconciliationAuthority[];
  sourceInvoices: readonly HospitalityCommercialSettlementReconciliationSourceInvoice[];
  amendments: readonly HospitalityCommercialSettlementReconciliationAmendment[];
  targetPricingEvidence: readonly HospitalityCommercialSettlementReconciliationTargetEvidence[];
}) {
  const sourceInvoiceById = new Map(input.sourceInvoices.map((sourceInvoice) => [sourceInvoice.id, sourceInvoice]));
  const amendmentById = new Map(input.amendments.map((amendment) => [amendment.id, amendment]));
  const targetById = new Map(input.targetPricingEvidence.map((evidence) => [evidence.id, evidence]));
  const grouped = new Map<string, HospitalityCommercialSettlementReconciliationAuthority[]>();

  for (const authority of input.authorities) {
    const key = authorityGroupKey(authority);
    const group = grouped.get(key) ?? [];
    group.push(authority);
    grouped.set(key, group);
  }

  const verified = new Map<string, readonly HospitalityCommercialSettlementReconciliationAuthority[]>();
  for (const [key, group] of grouped) {
    const ordered = [...group].sort((left, right) => {
      if (left.sourceAdjustmentOrdinal !== right.sourceAdjustmentOrdinal) {
        return left.sourceAdjustmentOrdinal - right.sourceAdjustmentOrdinal;
      }
      return left.documentNumber.localeCompare(right.documentNumber);
    });
    const documentNumbers = new Set<string>();
    const amendmentIds = new Set<string>();
    const targetEvidenceIds = new Set<string>();
    const sourceInvoice = ordered[0] ? sourceInvoiceById.get(ordered[0].sourceInvoiceId) : undefined;
    let valid = ordered.length > 0;
    let previous: HospitalityCommercialSettlementReconciliationAuthority | null = null;

    for (let index = 0; valid && index < ordered.length; index += 1) {
      const authority = ordered[index]!;
      if (
        authority.sourceAdjustmentOrdinal !== index + 1
        || documentNumbers.has(authority.documentNumber)
        || amendmentIds.has(authority.commercialAmendmentId)
        || targetEvidenceIds.has(authority.targetPricingEvidenceId)
        || !sourceInvoiceMatchesAuthority({ authority, sourceInvoice })
        || (index === 0 && sourceInvoice?.totalMinor !== authority.beforeTotalMinor)
        || (index === 0 && sourceInvoice?.pricingFingerprint !== authority.beforePricingFingerprint)
        || (previous && authority.currency !== previous.currency)
        || (previous && authority.beforeTotalMinor !== previous.afterTotalMinor)
        || (previous && authority.issuedAt.getTime() < previous.issuedAt.getTime())
        || (previous && authority.commercialAmendmentAppliedAt.getTime() < previous.issuedAt.getTime())
        || (previous && authority.beforePricingFingerprint !== previous.afterPricingFingerprint)
        || !currentAuthorityMatchesPersistence({
          authority,
          amendment: amendmentById.get(authority.commercialAmendmentId),
          target: targetById.get(authority.targetPricingEvidenceId),
        })
      ) {
        valid = false;
        break;
      }
      documentNumbers.add(authority.documentNumber);
      amendmentIds.add(authority.commercialAmendmentId);
      targetEvidenceIds.add(authority.targetPricingEvidenceId);
      previous = authority;
    }

    if (valid) verified.set(key, Object.freeze(ordered));
  }

  return verified;
}
