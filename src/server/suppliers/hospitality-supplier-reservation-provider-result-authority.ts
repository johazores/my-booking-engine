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
  if (typeof input.currency !== 'string' || typeof input.amountMinor !== 'bigint') invalidResult();
  return Object.freeze({ currency: input.currency, amountMinor: input.amountMinor });
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
    if (
      (input.remainder !== null && typeof input.remainder !== 'boolean')
      || (input.dueDateLocal !== null && typeof input.dueDateLocal !== 'string')
    ) {
      invalidResult();
    }
    snapshot.push(Object.freeze({
      remainder: input.remainder,
      dueDateLocal: input.dueDateLocal,
      money: money(input.money),
    }) as (typeof snapshot)[number]);
  }
  return Object.freeze(snapshot);
}

function commercialOffer(value: unknown): CommercialOfferSnapshot | null {
  if (value === null) return null;
  const input = record(value);
  const price = record(input.price);
  if (
    typeof input.supplierPropertyReference !== 'string'
    || typeof input.supplierOfferReference !== 'string'
    || typeof input.offerFingerprint !== 'string'
    || typeof price.currency !== 'string'
    || typeof price.totalMinor !== 'bigint'
  ) {
    invalidResult();
  }
  return Object.freeze({
    supplierPropertyReference: input.supplierPropertyReference,
    supplierOfferReference: input.supplierOfferReference,
    offerFingerprint: input.offerFingerprint,
    price: Object.freeze({ currency: price.currency, totalMinor: price.totalMinor }),
  });
}

function commercialBookingTerms(value: unknown): CommercialBookingTermsSnapshot | null {
  if (value === null) return null;
  const input = record(value);
  const price = record(input.price);
  if (
    typeof input.supplierPropertyReference !== 'string'
    || typeof input.supplierOfferReference !== 'string'
    || typeof input.termsFingerprint !== 'string'
    || typeof input.completeForReservationReview !== 'boolean'
    || input.revalidationRequired !== true
    || (input.paymentTiming !== 'PREPAY' && input.paymentTiming !== 'POSTPAY' && input.paymentTiming !== 'UNKNOWN')
    || (input.customerLoyaltyRequiredAtReservation !== null && typeof input.customerLoyaltyRequiredAtReservation !== 'boolean')
    || typeof price.currency !== 'string'
    || typeof price.totalMinor !== 'bigint'
  ) {
    invalidResult();
  }
  return Object.freeze({
    supplierPropertyReference: input.supplierPropertyReference,
    supplierOfferReference: input.supplierOfferReference,
    termsFingerprint: input.termsFingerprint,
    completeForReservationReview: input.completeForReservationReview,
    revalidationRequired: true,
    paymentTiming: input.paymentTiming,
    guaranteeTypes: guaranteeTypes(input.guaranteeTypes),
    customerLoyaltyRequiredAtReservation: input.customerLoyaltyRequiredAtReservation,
    deposits: deposits(input.deposits),
    acceptedPaymentCardCodes: stringArray(input.acceptedPaymentCardCodes, MAX_PAYMENT_CARD_CODES),
    price: Object.freeze({ currency: price.currency, totalMinor: price.totalMinor }),
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
    if (
      (input.authorityFingerprint !== null && typeof input.authorityFingerprint !== 'string')
      || (input.providerSubmissionReference !== null && typeof input.providerSubmissionReference !== 'string')
      || typeof input.observedAt !== 'string'
      || input.revalidationRequired !== true
    ) {
      invalidResult();
    }
    return Object.freeze({
      status: status(input.status, reservationAuthorityStatuses),
      offer: commercialOffer(input.offer),
      bookingTerms: commercialBookingTerms(input.bookingTerms),
      authorityFingerprint: input.authorityFingerprint,
      providerSubmissionReference: input.providerSubmissionReference,
      observedAt: input.observedAt,
      revalidationRequired: true as const,
    });
  });
}
