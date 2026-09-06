import {
  HospitalitySupplierReservationConflictError,
  hospitalitySupplierReservationRequestFingerprint,
  normalizeHospitalitySupplierReservationSelection,
} from './hospitality-supplier-reservation-domain.ts';

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export type HospitalitySupplierReservationSubmissionAuthorityOperation = Readonly<{
  requestFingerprint: string;
  requestFingerprintVersion: number | null;
  providerCode: string;
  supplierPropertyReference: string;
  supplierOfferReference: string;
  offerFingerprint: string;
  termsFingerprint: string;
  reservationPayloadFingerprint: string;
  currency: string;
  expectedTotalMinor: bigint;
  arrivalDate: Date;
  departureDate: Date;
  rooms: number;
  adults: number;
  childAges: readonly number[];
}>;

export type HospitalitySupplierReservationSubmissionAuthorityReview = Readonly<{
  status: 'READY' | 'PRICE_CHANGED' | 'OFFER_CHANGED' | 'TERMS_CHANGED' | 'TERMS_INCOMPLETE' | 'UNAVAILABLE';
  authorityFingerprint: string | null;
  observedAt: string;
  revalidationRequired: true;
  offer: Readonly<{
    supplierPropertyReference: string;
    supplierOfferReference: string;
    offerFingerprint: string;
    price: Readonly<{
      currency: string;
      totalMinor: bigint;
    }>;
  }> | null;
  bookingTerms: Readonly<{
    supplierPropertyReference: string;
    supplierOfferReference: string;
    termsFingerprint: string;
    completeForReservationReview: boolean;
    revalidationRequired: true;
    price: Readonly<{
      currency: string;
      totalMinor: bigint;
    }>;
  }> | null;
}>;

function operationDate(value: Date, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new HospitalitySupplierReservationConflictError(`${label} is unavailable for supplier reservation authority review.`);
  }
  return value.toISOString().slice(0, 10);
}

export function hospitalitySupplierReservationAuthorityInputFromOperation(
  operation: HospitalitySupplierReservationSubmissionAuthorityOperation,
) {
  if (operation.requestFingerprintVersion !== 2) {
    throw new HospitalitySupplierReservationConflictError(
      'Supplier reservation authority must be reviewed again from a current prepared request before submission.',
    );
  }

  return Object.freeze({
    supplierPropertyReference: operation.supplierPropertyReference,
    supplierOfferReference: operation.supplierOfferReference,
    expectedOfferFingerprint: operation.offerFingerprint,
    expectedTermsFingerprint: operation.termsFingerprint,
    expectedTotalMinor: operation.expectedTotalMinor,
    currency: operation.currency,
    checkInDateLocal: operationDate(operation.arrivalDate, 'Supplier reservation arrival date'),
    checkOutDateLocal: operationDate(operation.departureDate, 'Supplier reservation departure date'),
    rooms: operation.rooms,
    adults: operation.adults,
    childAges: Object.freeze([...operation.childAges]),
  });
}

function authorityConflict() {
  return new HospitalitySupplierReservationConflictError(
    'Supplier reservation authority changed after the request was prepared. Review the supplier offer and terms again.',
  );
}

export function assertHospitalitySupplierReservationSubmissionAuthority(
  operation: HospitalitySupplierReservationSubmissionAuthorityOperation,
  review: HospitalitySupplierReservationSubmissionAuthorityReview,
) {
  const authorityInput = hospitalitySupplierReservationAuthorityInputFromOperation(operation);
  if (
    review.status !== 'READY'
    || review.revalidationRequired !== true
    || !review.offer
    || !review.bookingTerms
    || review.bookingTerms.completeForReservationReview !== true
    || review.bookingTerms.revalidationRequired !== true
    || typeof review.authorityFingerprint !== 'string'
    || !FINGERPRINT_PATTERN.test(review.authorityFingerprint)
  ) {
    throw authorityConflict();
  }

  if (
    review.offer.supplierPropertyReference !== operation.supplierPropertyReference
    || review.offer.supplierOfferReference !== operation.supplierOfferReference
    || review.offer.offerFingerprint !== operation.offerFingerprint
    || review.offer.price.currency !== operation.currency
    || review.offer.price.totalMinor !== operation.expectedTotalMinor
    || review.bookingTerms.supplierPropertyReference !== operation.supplierPropertyReference
    || review.bookingTerms.supplierOfferReference !== operation.supplierOfferReference
    || review.bookingTerms.termsFingerprint !== operation.termsFingerprint
    || review.bookingTerms.price.currency !== operation.currency
    || review.bookingTerms.price.totalMinor !== operation.expectedTotalMinor
  ) {
    throw authorityConflict();
  }

  const reboundSelection = normalizeHospitalitySupplierReservationSelection({
    providerCode: operation.providerCode,
    supplierPropertyReference: operation.supplierPropertyReference,
    supplierOfferReference: operation.supplierOfferReference,
    offerFingerprint: operation.offerFingerprint,
    termsFingerprint: operation.termsFingerprint,
    reservationAuthorityFingerprint: review.authorityFingerprint,
    reservationPayloadFingerprint: operation.reservationPayloadFingerprint,
    currency: operation.currency,
    expectedTotalMinor: operation.expectedTotalMinor,
    arrivalDateLocal: authorityInput.checkInDateLocal,
    departureDateLocal: authorityInput.checkOutDateLocal,
    rooms: operation.rooms,
    adults: operation.adults,
    childAges: operation.childAges,
  });

  if (hospitalitySupplierReservationRequestFingerprint(reboundSelection) !== operation.requestFingerprint) {
    throw authorityConflict();
  }

  return Object.freeze({
    authorityFingerprint: review.authorityFingerprint,
    observedAt: review.observedAt,
  });
}
