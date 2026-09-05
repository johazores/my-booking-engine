import {
  deriveBookingSettlementSummary,
  type BookingSettlementTransaction,
} from './payment-settlement-domain.ts';

export const HOSPITALITY_CANCELLATION_AFTER_AMENDMENT_REFUND_LIMIT = 256;

export class HospitalityCancellationAfterAmendmentAdjustmentReadinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityCancellationAfterAmendmentAdjustmentReadinessError';
  }
}

export type HospitalityCancellationAfterAmendmentChainHead = Readonly<{
  adjustmentNoteId: string;
  sourceAdjustmentOrdinal: number;
  documentNumber: string;
  issuedAt: Date;
  documentFingerprint: string;
  afterPricingFingerprint: string;
  currency: string;
  accommodationSubtotalMinor: bigint;
  taxTotalMinor: bigint;
  feeTotalMinor: bigint;
  addonTotalMinor: bigint;
  totalMinor: bigint;
}>;

export type HospitalityCancellationAfterAmendmentPaymentTransaction = BookingSettlementTransaction & Readonly<{
  id: string;
  commercialAmendmentId: string | null;
  createdAt: Date;
}>;

export type HospitalityCancellationAfterAmendmentRefundAuthority = Readonly<{
  refundTransactionId: string;
  refundOrdinal: number;
  amountMinor: bigint;
  createdAt: Date;
}>;

export type HospitalityCancellationAfterAmendmentAdjustmentReadiness = Readonly<
  | { ready: false; reason: string }
  | {
      ready: true;
      sourceAdjustmentOrdinal: number;
      predecessorAdjustmentNoteId: string;
      predecessorSourceAdjustmentOrdinal: number;
      predecessorAdjustmentDocumentNumber: string;
      predecessorAdjustmentIssuedAt: Date;
      predecessorAdjustmentDocumentFingerprint: string;
      predecessorAfterPricingFingerprint: string;
      currency: 'AUD';
      decreaseSubtotalMinor: bigint;
      decreaseTaxMinor: bigint;
      decreaseTotalMinor: bigint;
      refundAuthorities: readonly HospitalityCancellationAfterAmendmentRefundAuthority[];
    }
>;

function unavailable(reason: string): HospitalityCancellationAfterAmendmentAdjustmentReadiness {
  return Object.freeze({ ready: false as const, reason });
}

function standardGstHead(head: HospitalityCancellationAfterAmendmentChainHead) {
  return head.currency.trim().toUpperCase() === 'AUD'
    && head.sourceAdjustmentOrdinal >= 1
    && !Number.isNaN(head.issuedAt.getTime())
    && head.accommodationSubtotalMinor >= 0n
    && head.taxTotalMinor > 0n
    && head.feeTotalMinor >= 0n
    && head.addonTotalMinor >= 0n
    && head.totalMinor > 0n
    && head.totalMinor === head.accommodationSubtotalMinor + head.taxTotalMinor + head.feeTotalMinor + head.addonTotalMinor
    && head.taxTotalMinor * 11n === head.totalMinor
    && /^[a-f0-9]{64}$/.test(head.documentFingerprint)
    && /^[a-f0-9]{64}$/.test(head.afterPricingFingerprint);
}

export function deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness(input: Readonly<{
  bookingStatus: string;
  bookingPaymentStatus: string;
  bookingCurrency: string;
  bookingTotalMinor: bigint;
  chainHead: HospitalityCancellationAfterAmendmentChainHead | null;
  transactions: readonly HospitalityCancellationAfterAmendmentPaymentTransaction[];
}>): HospitalityCancellationAfterAmendmentAdjustmentReadiness {
  const head = input.chainHead;
  if (!head) return unavailable('Cancellation-after-amendment requires an existing verified commercial adjustment-note chain.');
  if (!standardGstHead(head)) return unavailable('The verified commercial chain head is outside the supported AU/AUD standard-GST cancellation contract.');
  if (input.bookingStatus !== 'CANCELLED' || input.bookingPaymentStatus !== 'REFUNDED') {
    return unavailable('The booking must be cancelled and fully refunded before a terminal cancellation adjustment note can be issued.');
  }
  if (input.bookingCurrency.trim().toUpperCase() !== 'AUD' || input.bookingTotalMinor !== head.totalMinor) {
    return unavailable('The cancelled booking total must still match the verified current legal chain-head price.');
  }

  const headTime = head.issuedAt.getTime();
  const atHead = input.transactions.filter((transaction) => transaction.createdAt.getTime() <= headTime);
  const settlementAtHead = deriveBookingSettlementSummary({ currency: 'AUD', transactions: atHead });
  if (!settlementAtHead.reconciled || settlementAtHead.netSettledMinor !== head.totalMinor) {
    return unavailable('Payment settlement at the commercial chain head no longer reconciles to its immutable legal price.');
  }

  const afterHead = input.transactions.filter((transaction) => transaction.createdAt.getTime() > headTime);
  const invalidAfterHead = afterHead.find((transaction) => (
    transaction.status === 'PENDING'
    || transaction.status === 'AMBIGUOUS'
    || (transaction.status === 'SUCCEEDED' && (
      transaction.kind !== 'REFUND'
      || transaction.commercialAmendmentId !== null
      || transaction.currency !== 'AUD'
      || transaction.amountMinor <= 0n
      || transaction.sourceProviderReference == null
      || !transaction.sourceProviderReference.trim()
    ))
  ));
  if (invalidAfterHead) {
    return unavailable('Only resolved, source-attributed non-commercial refunds may change settlement after the verified legal chain head.');
  }

  const currentSettlement = deriveBookingSettlementSummary({ currency: 'AUD', transactions: input.transactions });
  if (!currentSettlement.reconciled || currentSettlement.netSettledMinor !== 0n) {
    return unavailable('Current payment settlement must reconcile exactly to zero before cancellation adjustment-note issuance.');
  }

  const refundRows = afterHead
    .filter((transaction) => transaction.status === 'SUCCEEDED' && transaction.kind === 'REFUND')
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
  if (refundRows.length === 0) return unavailable('At least one successful cancellation refund after the legal chain head is required.');
  if (refundRows.length > HOSPITALITY_CANCELLATION_AFTER_AMENDMENT_REFUND_LIMIT) {
    return unavailable(`Cancellation refund authority cannot exceed ${HOSPITALITY_CANCELLATION_AFTER_AMENDMENT_REFUND_LIMIT} transactions.`);
  }
  const refundIds = new Set(refundRows.map((transaction) => transaction.id));
  if (refundIds.size !== refundRows.length) return unavailable('Cancellation refund authority contains duplicate transaction identity.');
  const refundTotal = refundRows.reduce((total, transaction) => total + transaction.amountMinor, 0n);
  if (refundTotal !== head.totalMinor) {
    return unavailable('Cancellation refunds after the legal chain head do not equal the exact current legal price.');
  }

  const refundAuthorities = refundRows.map((transaction, index) => Object.freeze({
    refundTransactionId: transaction.id,
    refundOrdinal: index + 1,
    amountMinor: transaction.amountMinor,
    createdAt: transaction.createdAt,
  }));
  return Object.freeze({
    ready: true as const,
    sourceAdjustmentOrdinal: head.sourceAdjustmentOrdinal + 1,
    predecessorAdjustmentNoteId: head.adjustmentNoteId,
    predecessorSourceAdjustmentOrdinal: head.sourceAdjustmentOrdinal,
    predecessorAdjustmentDocumentNumber: head.documentNumber,
    predecessorAdjustmentIssuedAt: head.issuedAt,
    predecessorAdjustmentDocumentFingerprint: head.documentFingerprint,
    predecessorAfterPricingFingerprint: head.afterPricingFingerprint,
    currency: 'AUD' as const,
    decreaseSubtotalMinor: head.totalMinor - head.taxTotalMinor,
    decreaseTaxMinor: head.taxTotalMinor,
    decreaseTotalMinor: head.totalMinor,
    refundAuthorities: Object.freeze(refundAuthorities),
  });
}
