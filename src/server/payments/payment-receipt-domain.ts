export type PaymentReceiptTransaction = Readonly<{
  id: string;
  kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
  status: string;
  providerCode: string;
  providerReference: string | null;
  sourceProviderReference?: string | null;
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


/** Select the latest successful authorization without trusting input ordering. */
function latestReceiptAuthorization(transactions: readonly PaymentReceiptTransaction[]): PaymentReceiptTransaction | undefined {
  let latest: PaymentReceiptTransaction | undefined;
  for (const transaction of transactions) {
    if (transaction.status !== 'SUCCEEDED' || transaction.kind !== 'AUTHORIZATION') continue;
    if (!latest || transaction.createdAt.getTime() > latest.createdAt.getTime()
      || (transaction.createdAt.getTime() === latest.createdAt.getTime() && transaction.id > latest.id)) {
      latest = transaction;
    }
  }
  return latest;
}

/** A refund must belong to received money, not merely match aggregate totals. */
function assertReceiptRefundSources(transactions: readonly PaymentReceiptTransaction[]): void {
  const captured = transactions.filter((row) => row.kind === 'CAPTURE' || row.kind === 'OFFLINE_PAYMENT');
  const lastAuthorization = captured.length === 0
    ? latestReceiptAuthorization(transactions) : undefined;
  const sources = lastAuthorization ? [lastAuthorization] : captured;
  const amounts = new Map<string, { gross: bigint; refunded: bigint; createdAt: Date }>();
  const byProvider = new Map<string, string[]>();
  for (const source of sources) {
    const key = JSON.stringify([source.providerCode, source.providerReference]);
    if (amounts.has(key)) throw new PaymentReceiptEvidenceError('Payment receipt contains duplicate settlement sources.');
    amounts.set(key, { gross: source.amountMinor, refunded: 0n, createdAt: source.createdAt });
    byProvider.set(source.providerCode, [...(byProvider.get(source.providerCode) ?? []), key]);
  }
  for (const refund of transactions.filter((row) => row.kind === 'REFUND')) {
    const candidates = byProvider.get(refund.providerCode) ?? [];
    const key = refund.sourceProviderReference != null
      ? JSON.stringify([refund.providerCode, refund.sourceProviderReference])
      : candidates.length === 1 ? candidates[0] : undefined;
    const source = key ? amounts.get(key) : undefined;
    if (!source) throw new PaymentReceiptEvidenceError('Payment receipt refund source is missing or ambiguous.');
    if (refund.createdAt.getTime() < source.createdAt.getTime()) {
      throw new PaymentReceiptEvidenceError('Payment receipt refund predates its settled payment source.');
    }
    source.refunded += refund.amountMinor;
    if (source.refunded > source.gross) {
      throw new PaymentReceiptEvidenceError('Payment receipt refunds exceed their settled payment source.');
    }
  }
}

function hasReceiptIdentityControls(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

export function sanitizeSuccessfulPaymentTransactions(
  transactions: readonly PaymentReceiptTransaction[],
  expectedCurrency: string,
): PaymentReceiptTransaction[] {
  const seenSettlements = new Set<string>();
  const seenRefunds = new Set<string>();
  const seenAuthorizations = new Set<string>();
  const seenIds = new Set<string>();
  const safeTransactions = transactions
    .filter((transaction) => transaction.status === 'SUCCEEDED')
    .map((transaction) => {
      if (transaction.currency !== expectedCurrency) {
        throw new PaymentReceiptEvidenceError('Successful payment activity has a currency mismatch.');
      }
      if (typeof transaction.amountMinor !== 'bigint' || transaction.amountMinor <= 0n) {
        throw new PaymentReceiptEvidenceError('Successful payment activity must have a positive bigint amount.');
      }
      if (!['OFFLINE_PAYMENT', 'AUTHORIZATION', 'CAPTURE', 'REFUND'].includes(transaction.kind)) {
        throw new PaymentReceiptEvidenceError('Successful payment activity has an unsupported operation kind.');
      }
      if (!(transaction.createdAt instanceof Date) || !Number.isFinite(transaction.createdAt.getTime())) {
        throw new PaymentReceiptEvidenceError('Successful payment activity has an invalid creation timestamp.');
      }
      if (typeof transaction.id !== 'string' || !transaction.id || seenIds.has(transaction.id)) {
        throw new PaymentReceiptEvidenceError('Successful payment activity has a missing or duplicate transaction ID.');
      }
      seenIds.add(transaction.id);
      if (
        typeof transaction.providerCode !== 'string' || !transaction.providerCode.trim()
        || transaction.providerCode.trim() !== transaction.providerCode
        || typeof transaction.providerReference !== 'string' || !transaction.providerReference.trim()
        || transaction.providerReference.trim() !== transaction.providerReference
        || hasReceiptIdentityControls(transaction.providerCode)
        || hasReceiptIdentityControls(transaction.providerReference)
        || transaction.providerReference.startsWith('sf_claim_')
      ) {
        throw new PaymentReceiptEvidenceError('Successful payment activity is missing verified provider identity.');
      }
      const sourceReference = transaction.sourceProviderReference;
      if (sourceReference != null && (
        typeof sourceReference !== 'string' || !sourceReference.trim()
        || sourceReference.trim() !== sourceReference
        || hasReceiptIdentityControls(sourceReference)
        || sourceReference.startsWith('sf_claim_')
      )) {
        throw new PaymentReceiptEvidenceError('Successful payment activity has an invalid refund source reference.');
      }
      if (transaction.kind !== 'REFUND' && sourceReference != null) {
        throw new PaymentReceiptEvidenceError('Non-refund receipt evidence has refund source attribution.');
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

  assertReceiptRefundSources(safeTransactions);
  return safeTransactions.sort((left, right) => {
    const chronology = left.createdAt.getTime() - right.createdAt.getTime();
    if (chronology !== 0) return chronology;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export function summarizeSuccessfulPaymentActivity(
  transactions: PaymentReceiptTransaction[],
  bookingPaymentStatus?: string,
) {
  let capturedMinor = 0n;
  let refundedMinor = 0n;

  for (const transaction of transactions) {
    if (transaction.status !== 'SUCCEEDED') continue;
    if (transaction.kind === 'OFFLINE_PAYMENT' || transaction.kind === 'CAPTURE') {
      capturedMinor += transaction.amountMinor;
    } else if (transaction.kind === 'REFUND') {
      refundedMinor += transaction.amountMinor;
    }
  }

  const directAuthorization = latestReceiptAuthorization(transactions);
  if (capturedMinor === 0n && isReceiptEligiblePaymentStatus(bookingPaymentStatus ?? '') && directAuthorization) {
    capturedMinor = directAuthorization.amountMinor;
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
    fallbackAuthorizationId = latestReceiptAuthorization(transactions)?.id ?? null;
  }

  return transactions
    .filter((transaction) => transaction.status === 'SUCCEEDED')
    .sort((left, right) => {
      const chronology = left.createdAt.getTime() - right.createdAt.getTime();
      if (chronology !== 0) return chronology;
      // Show payments before refunds when database timestamps coincide.
      if (left.kind === 'REFUND' && right.kind !== 'REFUND') return 1;
      if (right.kind === 'REFUND' && left.kind !== 'REFUND') return -1;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    })
    .flatMap((transaction) => {
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
