export type PaymentReceiptTransaction = Readonly<{
  id: string;
  kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
  status: string;
  providerCode: string;
  providerReference: string | null;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
}>;

const SETTLED_PAYMENT_STATUSES = new Set(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);

export class PaymentReceiptEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentReceiptEvidenceError';
  }
}


export type PaymentReceiptBookingSnapshot = Readonly<{
  arrivalDate: Date;
  departureDate: Date;
  accommodationSubtotalMinor: bigint;
  taxTotalMinor: bigint;
  feeTotalMinor: bigint;
  addonTotalMinor: bigint;
  totalMinor: bigint;
}>;

/** Refuse receipts based on contradictory persisted booking money or stay dates. */
export function assertPaymentReceiptBookingSnapshot(booking: PaymentReceiptBookingSnapshot): void {
  if (!(booking.arrivalDate instanceof Date) || !Number.isFinite(booking.arrivalDate.getTime())
    || !(booking.departureDate instanceof Date) || !Number.isFinite(booking.departureDate.getTime())
    || booking.arrivalDate.getTime() >= booking.departureDate.getTime()) {
    throw new PaymentReceiptEvidenceError('Booking receipt stay dates are inconsistent.');
  }

  const components = [
    booking.accommodationSubtotalMinor,
    booking.taxTotalMinor,
    booking.feeTotalMinor,
    booking.addonTotalMinor,
  ];
  if (components.some((amount) => typeof amount !== 'bigint' || amount < 0n)
    || typeof booking.totalMinor !== 'bigint' || booking.totalMinor <= 0n
    || components.reduce((total, amount) => total + amount, 0n) !== booking.totalMinor) {
    throw new PaymentReceiptEvidenceError('Booking receipt price snapshot is inconsistent.');
  }
}

export type PaymentReceiptSettlementSnapshot = Readonly<{
  capturedMinor: bigint;
  refundedMinor: bigint;
  netPaidMinor: bigint;
}>;

/** Do not publish a settled receipt when the booking state contradicts persisted money. */
export function assertPaymentReceiptSettlementState(
  paymentStatus: string,
  bookingTotalMinor: bigint,
  settlement: PaymentReceiptSettlementSnapshot,
): void {
  const { capturedMinor, refundedMinor, netPaidMinor } = settlement;
  if (
    !isReceiptEligiblePaymentStatus(paymentStatus)
    || typeof bookingTotalMinor !== 'bigint' || bookingTotalMinor <= 0n
    || typeof capturedMinor !== 'bigint' || capturedMinor <= 0n
    || typeof refundedMinor !== 'bigint' || refundedMinor < 0n || refundedMinor > capturedMinor
    || typeof netPaidMinor !== 'bigint' || netPaidMinor !== capturedMinor - refundedMinor
  ) {
    throw new PaymentReceiptEvidenceError('Payment receipt settlement evidence is inconsistent.');
  }

  const reconciled = paymentStatus === 'PAID'
    ? netPaidMinor === bookingTotalMinor
    : paymentStatus === 'PARTIALLY_REFUNDED'
      ? refundedMinor > 0n && netPaidMinor > 0n && netPaidMinor < bookingTotalMinor
      : refundedMinor > 0n && netPaidMinor === 0n;

  if (!reconciled) {
    throw new PaymentReceiptEvidenceError('Booking payment status does not match settled receipt money.');
  }
}

export function buildPaymentReceiptNumber(bookingId: string): string {
  return `SF-${bookingId.replaceAll('-', '').slice(0, 16).toUpperCase()}`;
}

export function isReceiptEligiblePaymentStatus(paymentStatus: string): boolean {
  return SETTLED_PAYMENT_STATUSES.has(paymentStatus);
}

export function sanitizeSuccessfulPaymentTransactions(
  transactions: PaymentReceiptTransaction[],
  expectedCurrency: string,
): PaymentReceiptTransaction[] {
  const seenSettlements = new Set<string>();
  const seenRefunds = new Set<string>();
  const seenAuthorizations = new Set<string>();
  const safeTransactions = transactions
    .filter((transaction) => transaction.status === 'SUCCEEDED')
    .map((transaction) => {
      if (transaction.currency !== expectedCurrency) {
        throw new PaymentReceiptEvidenceError('Successful payment activity has a currency mismatch.');
      }
      if (transaction.amountMinor <= 0n) {
        throw new PaymentReceiptEvidenceError('Successful payment activity must have a positive amount.');
      }
      if (
        typeof transaction.providerCode !== 'string' || !transaction.providerCode.trim()
        || typeof transaction.providerReference !== 'string' || !transaction.providerReference.trim()
        || transaction.providerReference.startsWith('sf_claim_')
      ) {
        throw new PaymentReceiptEvidenceError('Successful payment activity is missing verified provider identity.');
      }
      const referenceKey = `${transaction.providerCode}\u001f${transaction.providerReference}`;
      const seen = transaction.kind === 'REFUND'
        ? seenRefunds
        : transaction.kind === 'AUTHORIZATION' ? seenAuthorizations : seenSettlements;
      if (seen.has(referenceKey)) {
        throw new PaymentReceiptEvidenceError('Successful payment activity contains a duplicate provider operation.');
      }
      seen.add(referenceKey);
      return { ...transaction };
    });

  return safeTransactions;
}

export function summarizeSuccessfulPaymentActivity(
  transactions: PaymentReceiptTransaction[],
  bookingPaymentStatus?: string,
) {
  let capturedMinor = 0n;
  let refundedMinor = 0n;
  let successfulAuthorizationMinor = 0n;

  for (const transaction of transactions) {
    if (transaction.status !== 'SUCCEEDED') continue;
    if (transaction.kind === 'OFFLINE_PAYMENT' || transaction.kind === 'CAPTURE') {
      capturedMinor += transaction.amountMinor;
    } else if (transaction.kind === 'REFUND') {
      refundedMinor += transaction.amountMinor;
    } else if (transaction.kind === 'AUTHORIZATION') {
      successfulAuthorizationMinor = transaction.amountMinor;
    }
  }

  if (capturedMinor === 0n && isReceiptEligiblePaymentStatus(bookingPaymentStatus ?? '') && successfulAuthorizationMinor > 0n) {
    capturedMinor = successfulAuthorizationMinor;
  }

  return {
    capturedMinor,
    refundedMinor,
    netPaidMinor: capturedMinor - refundedMinor,
  };
}

export type CustomerSettlementEntry = Readonly<{
  kind: 'PAYMENT' | 'REFUND';
  amountMinor: bigint;
  createdAt: Date;
}>;

export function buildCustomerSettlementEntries(
  transactions: PaymentReceiptTransaction[],
  bookingPaymentStatus: string,
): CustomerSettlementEntry[] {
  const hasDirectCapture = transactions.some((transaction) => (
    transaction.status === 'SUCCEEDED'
    && (transaction.kind === 'OFFLINE_PAYMENT' || transaction.kind === 'CAPTURE')
  ));
  let fallbackAuthorizationId: string | null = null;

  if (!hasDirectCapture && isReceiptEligiblePaymentStatus(bookingPaymentStatus)) {
    fallbackAuthorizationId = [...transactions]
      .reverse()
      .find((transaction) => transaction.status === 'SUCCEEDED' && transaction.kind === 'AUTHORIZATION')?.id ?? null;
  }

  return transactions.flatMap((transaction) => {
    if (transaction.status !== 'SUCCEEDED') return [];
    if (transaction.kind === 'REFUND') {
      return [{ kind: 'REFUND' as const, amountMinor: transaction.amountMinor, createdAt: transaction.createdAt }];
    }
    if (
      transaction.kind === 'OFFLINE_PAYMENT'
      || transaction.kind === 'CAPTURE'
      || (transaction.kind === 'AUTHORIZATION' && transaction.id === fallbackAuthorizationId)
    ) {
      return [{ kind: 'PAYMENT' as const, amountMinor: transaction.amountMinor, createdAt: transaction.createdAt }];
    }
    return [];
  });
}
