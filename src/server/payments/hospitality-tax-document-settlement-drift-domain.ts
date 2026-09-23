const AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN = /^AU-ADJ-[0-9]{8,}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type HospitalityTaxDocumentSettlementAuthority = Readonly<{
  documentNumber: string;
  refundTransactionIds: readonly string[];
}>;

export type HospitalityTaxDocumentCurrentRefundSettlement = Readonly<{
  id: string;
  status: string;
}>;

export type HospitalityTaxDocumentSettlementDrift = Readonly<{
  documentNumber: string;
}>;

function validDocumentNumber(value: string) {
  return AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN.test(value);
}

function validRefundId(value: string) {
  return UUID_PATTERN.test(value);
}

export function findHospitalityTaxDocumentSettlementDrift(input: Readonly<{
  authorities: readonly HospitalityTaxDocumentSettlementAuthority[];
  currentRefunds: readonly HospitalityTaxDocumentCurrentRefundSettlement[];
}>) {
  const statusByRefundId = new Map<string, string>();
  for (const refund of input.currentRefunds) {
    if (!validRefundId(refund.id)) throw new TypeError('Current refund settlement identity is invalid.');
    if (statusByRefundId.has(refund.id)) throw new TypeError('Current refund settlement identity is duplicated.');
    statusByRefundId.set(refund.id, refund.status);
  }

  const seenDocuments = new Set<string>();
  const drift: HospitalityTaxDocumentSettlementDrift[] = [];
  for (const authority of input.authorities) {
    if (!validDocumentNumber(authority.documentNumber)) {
      throw new TypeError('Settlement authority document number is invalid.');
    }
    if (seenDocuments.has(authority.documentNumber)) {
      throw new TypeError('Settlement authority document number is duplicated.');
    }
    seenDocuments.add(authority.documentNumber);
    if (authority.refundTransactionIds.length === 0) {
      throw new TypeError('Settlement authority requires at least one refund transaction identity.');
    }

    const seenRefundIds = new Set<string>();
    let hasCurrentStatusDrift = false;
    for (const refundId of authority.refundTransactionIds) {
      if (!validRefundId(refundId)) throw new TypeError('Settlement authority refund transaction identity is invalid.');
      if (seenRefundIds.has(refundId)) throw new TypeError('Settlement authority refund transaction identity is duplicated.');
      seenRefundIds.add(refundId);

      const currentStatus = statusByRefundId.get(refundId);
      // Missing rows are source/integrity failures, not provider lifecycle drift.
      if (currentStatus !== undefined && currentStatus !== 'SUCCEEDED') hasCurrentStatusDrift = true;
    }
    if (hasCurrentStatusDrift) drift.push(Object.freeze({ documentNumber: authority.documentNumber }));
  }
  return Object.freeze(drift);
}
