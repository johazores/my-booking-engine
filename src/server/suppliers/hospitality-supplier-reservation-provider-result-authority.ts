import type { HospitalitySupplierRuleGuaranteeType } from './hospitality-supplier-booking-terms.ts';
import { isExactHospitalitySupplierMachineToken } from './hospitality-supplier-machine-token.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const MAX_GUARANTEE_TYPES = 16;
const MAX_PAYMENT_CARD_CODES = 32;
const MAX_PAYMENT_CARD_CODE_LENGTH = 16;
const MAX_DEPOSITS = 16;
const MAX_REFERENCE_LENGTH = 4_096;
const MAX_OBSERVED_AT_LENGTH = 64;
const MAX_TOTAL_MINOR = 9_000_000_000_000_000n;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const FAILURE_MESSAGE = 'Supplier reservation provider result could not be materialized safely.';

const offerRevalidationStatuses = new Set([
  'UNCHANGED',
  'PRICE_CHANGED',
  'OFFER_CHANGED',
  'UNAVAILABLE',
] as const);
const bookingTermsStatuses = new Set([
  'READY',
  'PRICE_CHANGED',
  'OFFER_CHANGED',
  'UNAVAILABLE',
] as const);
const reservationAuthorityStatuses = new Set([
  'READY',
  'PRICE_CHANGED',
  'OFFER_CHANGED',
  'TERMS_CHANGED',
  'TERMS_INCOMPLETE',
  'UNAVAILABLE',
] as const);
const allowedGuaranteeTypes = new Set<HospitalitySupplierRuleGuaranteeType>([
  'PREPAY_REQUIRED',
  'DEPOSIT_REQUIRED',
  'GUARANTEES_NOT_REQUIRED',
  'PROFILE',
  'DEPOSIT_NOT_REQUIRED',
  'NO_GUARANTEES_ACCEPTED',
  'GUARANTEE_REQUIRED',
  'CREDIT_DEBIT_VOUCHER',
  'PREPAY_NOT_REQUIRED',
  'GUARANTEES_ACCEPTED',
  'NO_DEPOSITS_ACCEPTED',
  'UNKNOWN',
]);

type RecordValue = Record<string, unknown>;

type CommercialOfferSnapshot = Readonly<{
  supplierPropertyReference: string;
  supplierOfferReference: string;
  offerFingerprint: string;
  price: Readonly<{
    currency: string;
    totalMinor: bigint;
  }>;
}>;

type CommercialBookingTermsSnapshot = Readonly<{
  supplierPropertyReference: string;
  supplierOfferReference: string;
  termsFingerprint: string;
  completeForReservationReview: boolean;
  revalidationRequired: true;
  paymentTiming: 'PREPAY' | 'POSTPAY' | 'UNKNOWN';
  guaranteeTypes: readonly HospitalitySupplierRuleGuaranteeType[];
  customerLoyaltyRequiredAtReservation: boolean | null;
  deposits: readonly Readonly<{
    remainder: boolean | null;
    dueDateLocal: string | null;
    money: Readonly<{ currency: string; amountMinor: bigint }> | null;
  }>[];
  acceptedPaymentCardCodes: readonly string[];
  price: Readonly<{
    currency: string;
    totalMinor: bigint;
  }>;
}>;

function invalidResult(): never {
  throw new HospitalitySupplierProviderError('INVALID_RESPONSE', FAILURE_MESSAGE);
}

function materialize<T>(read: () => T): T {
  try {
    return read();
  } catch {
    invalidResult();
  }
}

function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResult();
  return value as RecordValue;
}

function boundedArray(value: unknown, maxLength: number) {
  if (!Array.isArray(value)) invalidResult();
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > maxLength) invalidResult();
  return { value, length } as const;
}

function machineToken(value: unknown, maxLength = MAX_REFERENCE_LENGTH) {
  if (!isExactHospitalitySupplierMachineToken(value, maxLength)) invalidResult();
  return value;
}

function fingerprint(value: unknown) {
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) invalidResult();
  return value;
}

function currency(value: unknown) {
  if (typeof value !== 'string' || !CURRENCY_PATTERN.test(value)) invalidResult();
  return value;
}

function nonNegativeMinor(value: unknown) {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_TOTAL_MINOR) invalidResult();
  return value;
}

function nullableLocalDate(value: unknown) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalidResult();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalidResult();
  return value;
}

function uniqueStringArray(
  value: unknown,
  maxLength: number,
  validate: (item: unknown) => string,
) {
  const array = boundedArray(value, maxLength);
  const snapshot: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < array.length; index += 1) {
    const item = array.value[index];
    const normalized = validate(item);
    if (seen.has(normalized)) invalidResult();
    seen.add(normalized);
    snapshot.push(normalized);
  }
  return Object.freeze(snapshot);
}

function guaranteeTypes(value: unknown) {
  return uniqueStringArray(value, MAX_GUARANTEE_TYPES, (item) => {
    if (typeof item !== 'string' || !allowedGuaranteeTypes.has(item as HospitalitySupplierRuleGuaranteeType)) {
      invalidResult();
    }
    return item;
  }) as readonly HospitalitySupplierRuleGuaranteeType[];
}

function acceptedPaymentCardCodes(value: unknown) {
  return uniqueStringArray(
    value,
    MAX_PAYMENT_CARD_CODES,
    (item) => machineToken(item, MAX_PAYMENT_CARD_CODE_LENGTH),
  );
}

function money(value: unknown) {
  if (value === null) return null;
  const input = record(value);
  const currencyValue = input.currency;
  const amountMinor = input.amountMinor;
  return Object.freeze({
    currency: currency(currencyValue),
    amountMinor: nonNegativeMinor(amountMinor),
  });
}

function deposits(value: unknown) {
  const array = boundedArray(value, MAX_DEPOSITS);
  const snapshot: Array<Readonly<{
    remainder: boolean | null;
    dueDateLocal: string | null;
    money: Readonly<{ currency: string; amountMinor: bigint }> | null;
  }>> = [];
  for (let index = 0; index < array.length; index += 1) {
    const input = record(array.value[index]);
    const remainder = input.remainder;
    const dueDateLocal = input.dueDateLocal;
    const depositMoney = input.money;
    if (remainder !== null && typeof remainder !== 'boolean') invalidResult();
    snapshot.push(Object.freeze({
      remainder,
      dueDateLocal: nullableLocalDate(dueDateLocal),
      money: money(depositMoney),
    }) as (typeof snapshot)[number]);
  }
  return Object.freeze(snapshot);
}

function commercialOffer(value: unknown): CommercialOfferSnapshot | null {
  if (value === null) return null;
  const input = record(value);
  const supplierPropertyReference = input.supplierPropertyReference;
  const supplierOfferReference = input.supplierOfferReference;
  const offerFingerprint = input.offerFingerprint;
  const price = record(input.price);
  const currencyValue = price.currency;
  const totalMinor = price.totalMinor;
  return Object.freeze({
    supplierPropertyReference: machineToken(supplierPropertyReference),
    supplierOfferReference: machineToken(supplierOfferReference),
    offerFingerprint: fingerprint(offerFingerprint),
    price: Object.freeze({
      currency: currency(currencyValue),
      totalMinor: nonNegativeMinor(totalMinor),
    }),
  });
}

function commercialBookingTerms(value: unknown): CommercialBookingTermsSnapshot | null {
  if (value === null) return null;
  const input = record(value);
  const supplierPropertyReference = input.supplierPropertyReference;
  const supplierOfferReference = input.supplierOfferReference;
  const termsFingerprint = input.termsFingerprint;
  const completeForReservationReview = input.completeForReservationReview;
  const revalidationRequired = input.revalidationRequired;
  const paymentTiming = input.paymentTiming;
  const guaranteeTypeValues = input.guaranteeTypes;
  const customerLoyaltyRequiredAtReservation = input.customerLoyaltyRequiredAtReservation;
  const depositValues = input.deposits;
  const acceptedPaymentCardCodeValues = input.acceptedPaymentCardCodes;
  const price = record(input.price);
  const currencyValue = price.currency;
  const totalMinor = price.totalMinor;
  if (
    typeof completeForReservationReview !== 'boolean'
    || revalidationRequired !== true
    || (paymentTiming !== 'PREPAY' && paymentTiming !== 'POSTPAY' && paymentTiming !== 'UNKNOWN')
    || (customerLoyaltyRequiredAtReservation !== null && typeof customerLoyaltyRequiredAtReservation !== 'boolean')
  ) {
    invalidResult();
  }
  return Object.freeze({
    supplierPropertyReference: machineToken(supplierPropertyReference),
    supplierOfferReference: machineToken(supplierOfferReference),
    termsFingerprint: fingerprint(termsFingerprint),
    completeForReservationReview,
    revalidationRequired: true,
    paymentTiming,
    guaranteeTypes: guaranteeTypes(guaranteeTypeValues),
    customerLoyaltyRequiredAtReservation,
    deposits: deposits(depositValues),
    acceptedPaymentCardCodes: acceptedPaymentCardCodes(acceptedPaymentCardCodeValues),
    price: Object.freeze({
      currency: currency(currencyValue),
      totalMinor: nonNegativeMinor(totalMinor),
    }),
  });
}

function status<T extends string>(value: unknown, allowed: ReadonlySet<T>): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) invalidResult();
  return value as T;
}

export function materializeHospitalitySupplierOfferRevalidationResult(value: unknown) {
  return materialize(() => {
    const input = record(value);
    return Object.freeze({
      status: status(input.status, offerRevalidationStatuses),
      offer: commercialOffer(input.offer),
    });
  });
}

export function materializeHospitalitySupplierBookingTermsResult(value: unknown) {
  return materialize(() => {
    const input = record(value);
    return Object.freeze({
      status: status(input.status, bookingTermsStatuses),
      offer: commercialOffer(input.offer),
      bookingTerms: commercialBookingTerms(input.bookingTerms),
    });
  });
}

export function materializeHospitalitySupplierReservationAuthorityResult(value: unknown) {
  return materialize(() => {
    const input = record(value);
    const resultStatus = input.status;
    const offer = input.offer;
    const bookingTerms = input.bookingTerms;
    const authorityFingerprint = input.authorityFingerprint;
    const providerSubmissionReference = input.providerSubmissionReference;
    const observedAt = input.observedAt;
    const revalidationRequired = input.revalidationRequired;
    if (revalidationRequired !== true) invalidResult();
    return Object.freeze({
      status: status(resultStatus, reservationAuthorityStatuses),
      offer: commercialOffer(offer),
      bookingTerms: commercialBookingTerms(bookingTerms),
      authorityFingerprint: authorityFingerprint === null ? null : fingerprint(authorityFingerprint),
      providerSubmissionReference: providerSubmissionReference === null
        ? null
        : machineToken(providerSubmissionReference),
      observedAt: machineToken(observedAt, MAX_OBSERVED_AT_LENGTH),
      revalidationRequired: true as const,
    });
  });
}
