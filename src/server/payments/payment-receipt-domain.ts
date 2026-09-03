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
  const safeTransactions = transactions
    .filter((transaction) => transaction.status === 'SUCCEEDED')
    .map((transaction) => {
      if (transaction.currency !== expectedCurrency) {
        throw new PaymentReceiptEvidenceError('Successful payment activity has a currency mismatch.');
      }
      if (transaction.amountMinor <= 0n) {
        throw new PaymentReceiptEvidenceError('Successful payment activity must have a positive amount.');
      }
      return {
        ...transaction,
        providerReference: transaction.providerReference?.startsWith('sf_claim_') ? null : transaction.providerReference,
      };
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
