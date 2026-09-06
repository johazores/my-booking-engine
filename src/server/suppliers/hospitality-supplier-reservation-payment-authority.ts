import type {
  HospitalitySupplierBookingTerms,
  HospitalitySupplierRuleGuaranteeType,
} from './hospitality-supplier-booking-terms.ts';

const DECISIVE_GUARANTEE_TYPES = new Set(['PREPAY_REQUIRED', 'DEPOSIT_REQUIRED', 'GUARANTEE_REQUIRED'] as const);
const MAX_PAYMENT_CARD_CODE_LENGTH = 16;
const MAX_PAYMENT_CARD_CODES = 32;
const MAX_GUARANTEE_TYPES = 16;

type DecisiveGuaranteeType = 'PREPAY_REQUIRED' | 'DEPOSIT_REQUIRED' | 'GUARANTEE_REQUIRED';

export type HospitalitySupplierReservationPaymentAuthority = Readonly<{
  kind: 'PREPAY' | 'DEPOSIT' | 'GUARANTEE';
  collectionTiming: 'AT_BOOKING' | 'AT_PROPERTY';
  currency: string;
  amountMinor: bigint;
  acceptedPaymentCardCodes: readonly string[];
}>;

function acceptedPaymentCardCodes(values: readonly string[]) {
  if (values.length < 1 || values.length > MAX_PAYMENT_CARD_CODES) return null;

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

function decisiveGuaranteeType(values: readonly HospitalitySupplierRuleGuaranteeType[]): DecisiveGuaranteeType | null {
  if (values.length < 1 || values.length > MAX_GUARANTEE_TYPES) return null;
  const decisive = [...new Set(values.filter(
    (value): value is DecisiveGuaranteeType => DECISIVE_GUARANTEE_TYPES.has(value as DecisiveGuaranteeType),
  ))];
  if (decisive.length !== 1) return null;

  const selected = decisive[0]!;
  if (
    (selected === 'PREPAY_REQUIRED' && values.includes('PREPAY_NOT_REQUIRED'))
    || (selected === 'DEPOSIT_REQUIRED' && (values.includes('DEPOSIT_NOT_REQUIRED') || values.includes('NO_DEPOSITS_ACCEPTED')))
    || (selected === 'GUARANTEE_REQUIRED' && (values.includes('GUARANTEES_NOT_REQUIRED') || values.includes('NO_GUARANTEES_ACCEPTED')))
  ) {
    return null;
  }
  return selected;
}

export function deriveHospitalitySupplierReservationPaymentAuthority(input: {
  bookingTerms: Pick<HospitalitySupplierBookingTerms, 'guaranteeTypes' | 'deposits' | 'acceptedPaymentCardCodes'>;
  currency: string;
  expectedTotalMinor: bigint;
}): HospitalitySupplierReservationPaymentAuthority | null {
  if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) return null;
  if (typeof input.expectedTotalMinor !== 'bigint' || input.expectedTotalMinor < 0n) return null;

  const decisive = decisiveGuaranteeType(input.bookingTerms.guaranteeTypes);
  if (!decisive) return null;

  const cardCodes = acceptedPaymentCardCodes(input.bookingTerms.acceptedPaymentCardCodes);
  if (!cardCodes) return null;

  if (decisive === 'PREPAY_REQUIRED') {
    return Object.freeze({
      kind: 'PREPAY',
      collectionTiming: 'AT_BOOKING',
      currency: input.currency,
      amountMinor: input.expectedTotalMinor,
      acceptedPaymentCardCodes: cardCodes,
    });
  }

  if (decisive === 'GUARANTEE_REQUIRED') {
    return Object.freeze({
      kind: 'GUARANTEE',
      collectionTiming: 'AT_PROPERTY',
      currency: input.currency,
      amountMinor: input.expectedTotalMinor,
      acceptedPaymentCardCodes: cardCodes,
    });
  }

  if (input.bookingTerms.deposits.length !== 1) return null;
  const deposit = input.bookingTerms.deposits[0]?.money;
  if (!deposit) return null;
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
