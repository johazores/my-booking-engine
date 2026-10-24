import type {
  HospitalitySupplierBookingTerms,
  HospitalitySupplierRuleGuaranteeType,
} from './hospitality-supplier-booking-terms.ts';
import { isExactHospitalitySupplierMachineToken } from './hospitality-supplier-machine-token.ts';

const DECISIVE_GUARANTEE_TYPES = new Set(['PREPAY_REQUIRED', 'DEPOSIT_REQUIRED', 'GUARANTEE_REQUIRED'] as const);
const MAX_PAYMENT_CARD_CODE_LENGTH = 16;
const MAX_PAYMENT_CARD_CODES = 32;
const MAX_GUARANTEE_TYPES = 16;

type DecisiveGuaranteeType = 'PREPAY_REQUIRED' | 'DEPOSIT_REQUIRED' | 'GUARANTEE_REQUIRED';

/**
 * Copy bounded supplier evidence by index, never through caller-controlled
 * iterators or array methods. The snapshot is the only payment authority.
 */
function boundedArraySnapshot<T>(value: unknown, min: number, max: number): readonly T[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < min || length > max) return null;
    const snapshot: T[] = [];
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(value, index)) return null;
      snapshot.push(value[index] as T);
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}


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
    if (!isExactHospitalitySupplierMachineToken(value, MAX_PAYMENT_CARD_CODE_LENGTH)) {
      return null;
    }
    normalized.push(value);
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

function paymentTimingMatches(
  decisive: DecisiveGuaranteeType,
  paymentTiming: HospitalitySupplierBookingTerms['paymentTiming'],
) {
  if (decisive === 'GUARANTEE_REQUIRED') return paymentTiming === 'POSTPAY';
  return paymentTiming === 'PREPAY';
}

export function deriveHospitalitySupplierReservationPaymentAuthority(input: {
  bookingTerms: Pick<
    HospitalitySupplierBookingTerms,
    'paymentTiming' | 'guaranteeTypes' | 'deposits' | 'acceptedPaymentCardCodes'
  >;
  currency: string;
  expectedTotalMinor: bigint;
}): HospitalitySupplierReservationPaymentAuthority | null {
  try {
    const { bookingTerms, currency, expectedTotalMinor } = input;
    if (!bookingTerms || typeof bookingTerms !== 'object' || Array.isArray(bookingTerms)) return null;
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return null;
    if (typeof expectedTotalMinor !== 'bigint' || expectedTotalMinor < 0n) return null;

    const guaranteeTypes = boundedArraySnapshot<HospitalitySupplierRuleGuaranteeType>(
      bookingTerms.guaranteeTypes, 1, MAX_GUARANTEE_TYPES,
    );
    const cardEvidence = boundedArraySnapshot<string>(
      bookingTerms.acceptedPaymentCardCodes, 1, MAX_PAYMENT_CARD_CODES,
    );
    if (!guaranteeTypes || !cardEvidence) return null;

    const decisive = decisiveGuaranteeType(guaranteeTypes);
    const paymentTiming = bookingTerms.paymentTiming;
    if (!decisive || !paymentTimingMatches(decisive, paymentTiming)) return null;

    const cardCodes = acceptedPaymentCardCodes(cardEvidence);
    if (!cardCodes) return null;

    if (decisive === 'PREPAY_REQUIRED') {
      return Object.freeze({
        kind: 'PREPAY',
        collectionTiming: 'AT_BOOKING',
        currency,
        amountMinor: expectedTotalMinor,
        acceptedPaymentCardCodes: cardCodes,
      });
    }

    if (decisive === 'GUARANTEE_REQUIRED') {
      return Object.freeze({
        kind: 'GUARANTEE',
        collectionTiming: 'AT_PROPERTY',
        currency,
        amountMinor: expectedTotalMinor,
        acceptedPaymentCardCodes: cardCodes,
      });
    }

    const deposits = boundedArraySnapshot<HospitalitySupplierBookingTerms['deposits'][number]>(
      bookingTerms.deposits, 1, 1,
    );
    if (!deposits) return null;
    const deposit = deposits[0]?.money;
    if (!deposit || typeof deposit !== 'object' || Array.isArray(deposit)) return null;
    const depositCurrency = deposit.currency;
    const depositAmountMinor = deposit.amountMinor;
    if (
      depositCurrency !== currency
      || typeof depositAmountMinor !== 'bigint'
      || depositAmountMinor <= 0n
      || depositAmountMinor > expectedTotalMinor
    ) {
      return null;
    }

    return Object.freeze({
      kind: 'DEPOSIT',
      collectionTiming: 'AT_BOOKING',
      currency,
      amountMinor: depositAmountMinor,
      acceptedPaymentCardCodes: cardCodes,
    });
  } catch {
    // Unexpected getters/proxies are not commercial authority and must not
    // leak caller-controlled errors or allow a supplier Create to be claimed.
    return null;
  }
}
