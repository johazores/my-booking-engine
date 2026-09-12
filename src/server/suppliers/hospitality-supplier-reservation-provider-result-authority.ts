import type { HospitalitySupplierRuleGuaranteeType } from './hospitality-supplier-booking-terms.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const MAX_GUARANTEE_TYPES = 16;
const MAX_PAYMENT_CARD_CODES = 32;
const MAX_DEPOSITS = 16;
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

function stringArray(value: unknown, maxLength: number) {
  const array = boundedArray(value, maxLength);
  const snapshot: string[] = [];
  for (let index = 0; index < array.length; index += 1) {
    const item = array.value[index];
    if (typeof item !== 'string') invalidResult();
    snapshot.push(item);
  }
  return Object.freeze(snapshot);
}

function guaranteeTypes(value: unknown) {
  return stringArray(value, MAX_GUARANTEE_TYPES) as readonly HospitalitySupplierRuleGuaranteeType[];
}

function money(value: unknown) {
  if (value === null) return null;
  const input = record(value);
  const currency = input.currency;
  const amountMinor = input.amountMinor;
  if (typeof currency !== 'string' || typeof amountMinor !== 'bigint') invalidResult();
  return Object.freeze({ currency, amountMinor });
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
    if (
      (remainder !== null && typeof remainder !== 'boolean')
      || (dueDateLocal !== null && typeof dueDateLocal !== 'string')
    ) {
      invalidResult();
    }
    snapshot.push(Object.freeze({
      remainder,
      dueDateLocal,
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
  const currency = price.currency;
  const totalMinor = price.totalMinor;
  if (
    typeof supplierPropertyReference !== 'string'
    || typeof supplierOfferReference !== 'string'
    || typeof offerFingerprint !== 'string'
    || typeof currency !== 'string'
    || typeof totalMinor !== 'bigint'
  ) {
    invalidResult();
  }
  return Object.freeze({
    supplierPropertyReference,
    supplierOfferReference,
    offerFingerprint,
    price: Object.freeze({ currency, totalMinor }),
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
  const currency = price.currency;
  const totalMinor = price.totalMinor;
  if (
    typeof supplierPropertyReference !== 'string'
    || typeof supplierOfferReference !== 'string'
    || typeof termsFingerprint !== 'string'
    || typeof completeForReservationReview !== 'boolean'
    || revalidationRequired !== true
    || (paymentTiming !== 'PREPAY' && paymentTiming !== 'POSTPAY' && paymentTiming !== 'UNKNOWN')
    || (customerLoyaltyRequiredAtReservation !== null && typeof customerLoyaltyRequiredAtReservation !== 'boolean')
    || typeof currency !== 'string'
    || typeof totalMinor !== 'bigint'
  ) {
    invalidResult();
  }
  return Object.freeze({
    supplierPropertyReference,
    supplierOfferReference,
    termsFingerprint,
    completeForReservationReview,
    revalidationRequired: true,
    paymentTiming,
    guaranteeTypes: guaranteeTypes(guaranteeTypeValues),
    customerLoyaltyRequiredAtReservation,
    deposits: deposits(depositValues),
    acceptedPaymentCardCodes: stringArray(acceptedPaymentCardCodeValues, MAX_PAYMENT_CARD_CODES),
    price: Object.freeze({ currency, totalMinor }),
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
    if (
      (authorityFingerprint !== null && typeof authorityFingerprint !== 'string')
      || (providerSubmissionReference !== null && typeof providerSubmissionReference !== 'string')
      || typeof observedAt !== 'string'
      || revalidationRequired !== true
    ) {
      invalidResult();
    }
    return Object.freeze({
      status: status(resultStatus, reservationAuthorityStatuses),
      offer: commercialOffer(offer),
      bookingTerms: commercialBookingTerms(bookingTerms),
      authorityFingerprint,
      providerSubmissionReference,
      observedAt,
      revalidationRequired: true as const,
    });
  });
}
