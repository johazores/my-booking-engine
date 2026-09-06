import type { HospitalitySupplierBookingTerms } from './hospitality-supplier-booking-terms.ts';

const DECISIVE_GUARANTEE_TYPES = new Set(['PREPAY_REQUIRED', 'DEPOSIT_REQUIRED', 'GUARANTEE_REQUIRED'] as const);
const MAX_PAYMENT_CARD_CODE_LENGTH = 16;

export type HospitalitySupplierReservationPaymentAuthority = Readonly<{
  kind: 'PREPAY' | 'DEPOSIT' | 'GUARANTEE';
  collectionTiming: 'AT_BOOKING' | 'AT_PROPERTY';
  currency: string;
  amountMinor: bigint;
  acceptedPaymentCardCodes: readonly string[];
}>;

function acceptedPaymentCardCodes(values: readonly string[]) {
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') return null;
    const code = value.trim();
    if (!code || code.length > MAX_PAYMENT_CARD_CODE_LENGTH || /[\r\n]/.test(code)) return null;
    normalized.push(code);
  }
  if (new Set(normalized).size !== normalized.length) return null;
  return Object.freeze(normalized);
}

export function deriveHospitalitySupplierReservationPaymentAuthority(input: {
  bookingTerms: Pick<HospitalitySupplierBookingTerms, 'guaranteeTypes' | 'deposits' | 'acceptedPaymentCardCodes'>;
  currency: string;
  expectedTotalMinor: bigint;
}): HospitalitySupplierReservationPaymentAuthority | null {
  if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) return null;
  if (typeof input.expectedTotalMinor !== 'bigint' || input.expectedTotalMinor < 0n) return null;

  const decisive = [...new Set(input.bookingTerms.guaranteeTypes.filter(
    (value): value is 'PREPAY_REQUIRED' | 'DEPOSIT_REQUIRED' | 'GUARANTEE_REQUIRED' =>
      DECISIVE_GUARANTEE_TYPES.has(value as 'PREPAY_REQUIRED' | 'DEPOSIT_REQUIRED' | 'GUARANTEE_REQUIRED'),
  ))];
  if (decisive.length !== 1) return null;

  const cardCodes = acceptedPaymentCardCodes(input.bookingTerms.acceptedPaymentCardCodes);
  if (!cardCodes) return null;

  if (decisive[0] === 'PREPAY_REQUIRED') {
    return Object.freeze({
      kind: 'PREPAY',
      collectionTiming: 'AT_BOOKING',
      currency: input.currency,
      amountMinor: input.expectedTotalMinor,
      acceptedPaymentCardCodes: cardCodes,
    });
  }

  if (decisive[0] === 'GUARANTEE_REQUIRED') {
    return Object.freeze({
      kind: 'GUARANTEE',
      collectionTiming: 'AT_PROPERTY',
      currency: input.currency,
      amountMinor: input.expectedTotalMinor,
      acceptedPaymentCardCodes: cardCodes,
    });
  }

  const depositMoney = input.bookingTerms.deposits
    .map((deposit) => deposit.money)
    .filter((money): money is NonNullable<typeof money> => money !== null);
  if (depositMoney.length !== 1) return null;
  const deposit = depositMoney[0]!;
  if (
    deposit.currency !== input.currency
    || deposit.amountMinor <= 0n
    || deposit.amountMinor > input.expectedTotalMinor
  ) {
    return null;
  }

  return Object.freeze({
    kind: 'DEPOSIT',
    collectionTiming: 'AT_BOOKING',
    currency: input.currency,
    amountMinor: deposit.amountMinor,
    acceptedPaymentCardCodes: cardCodes,
  });
}
