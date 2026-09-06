import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hospitalitySupplierReservationRequestFingerprint,
  normalizeHospitalitySupplierReservationSelection,
} from './hospitality-supplier-reservation-domain.ts';
import {
  assertHospitalitySupplierReservationSubmissionAuthority,
  hospitalitySupplierReservationAuthorityInputFromOperation,
} from './hospitality-supplier-reservation-submission-authority.ts';

const authorityFingerprint = 'd'.repeat(64);
const baseSelection = normalizeHospitalitySupplierReservationSelection({
  providerCode: 'travelport-stays',
  supplierPropertyReference: 'property-ref',
  supplierOfferReference: 'offer-ref',
  offerFingerprint: 'a'.repeat(64),
  termsFingerprint: 'b'.repeat(64),
  reservationAuthorityFingerprint: authorityFingerprint,
  reservationPayloadFingerprint: 'c'.repeat(64),
  currency: 'USD',
  expectedTotalMinor: 125_500n,
  arrivalDateLocal: '2026-10-11',
  departureDateLocal: '2026-10-14',
  rooms: 1,
  adults: 2,
  childAges: [7],
});

const operation = Object.freeze({
  requestFingerprint: hospitalitySupplierReservationRequestFingerprint(baseSelection),
  requestFingerprintVersion: 2,
  providerCode: baseSelection.providerCode,
  supplierPropertyReference: baseSelection.supplierPropertyReference,
  supplierOfferReference: baseSelection.supplierOfferReference,
  offerFingerprint: baseSelection.offerFingerprint,
  termsFingerprint: baseSelection.termsFingerprint,
  reservationPayloadFingerprint: baseSelection.reservationPayloadFingerprint,
  currency: baseSelection.currency,
  expectedTotalMinor: baseSelection.expectedTotalMinor,
  arrivalDate: new Date('2026-10-11T00:00:00.000Z'),
  departureDate: new Date('2026-10-14T00:00:00.000Z'),
  rooms: baseSelection.rooms,
  adults: baseSelection.adults,
  childAges: baseSelection.childAges,
});

function readyReview(fingerprint = authorityFingerprint) {
  return Object.freeze({
    status: 'READY' as const,
    authorityFingerprint: fingerprint,
    providerSubmissionReference: 'availability-offer-current',
    observedAt: '2026-09-06T13:30:00.000Z',
    revalidationRequired: true as const,
    offer: Object.freeze({
      supplierPropertyReference: operation.supplierPropertyReference,
      supplierOfferReference: operation.supplierOfferReference,
      offerFingerprint: operation.offerFingerprint,
      price: Object.freeze({ currency: operation.currency, totalMinor: operation.expectedTotalMinor }),
    }),
    bookingTerms: Object.freeze({
      supplierPropertyReference: operation.supplierPropertyReference,
      supplierOfferReference: operation.supplierOfferReference,
      termsFingerprint: operation.termsFingerprint,
      completeForReservationReview: true,
      revalidationRequired: true as const,
      paymentTiming: 'POSTPAY' as const,
      guaranteeTypes: Object.freeze(['GUARANTEE_REQUIRED'] as const),
      customerLoyaltyRequiredAtReservation: false,
      deposits: Object.freeze([]),
      acceptedPaymentCardCodes: Object.freeze(['VI']),
      price: Object.freeze({ currency: operation.currency, totalMinor: operation.expectedTotalMinor }),
    }),
  });
}

test('rebuilds authority review input only from durable prepared operation evidence', () => {
  assert.deepEqual(hospitalitySupplierReservationAuthorityInputFromOperation(operation), {
    supplierPropertyReference: 'property-ref',
    supplierOfferReference: 'offer-ref',
    expectedOfferFingerprint: 'a'.repeat(64),
    expectedTermsFingerprint: 'b'.repeat(64),
    expectedTotalMinor: 125_500n,
    currency: 'USD',
    checkInDateLocal: '2026-10-11',
    checkOutDateLocal: '2026-10-14',
    rooms: 1,
    adults: 2,
    childAges: [7],
  });
});

test('accepts only READY authority that rebinds to the exact prepared request and payment semantics', () => {
  const result = assertHospitalitySupplierReservationSubmissionAuthority(operation, readyReview());
  assert.equal(result.authorityFingerprint, authorityFingerprint);
  assert.equal(result.providerSubmissionReference, 'availability-offer-current');
  assert.deepEqual(result.paymentAuthority, {
    kind: 'GUARANTEE',
    collectionTiming: 'AT_PROPERTY',
    currency: 'USD',
    amountMinor: 125_500n,
    acceptedPaymentCardCodes: ['VI'],
  });
});

test('rejects a fresh authority fingerprint that differs from the prepared request', () => {
  assert.throws(
    () => assertHospitalitySupplierReservationSubmissionAuthority(operation, readyReview('e'.repeat(64))),
    /authority changed/i,
  );
});

test('rejects missing or unsafe ephemeral provider submission authority', () => {
  for (const providerSubmissionReference of [null, 'bad\nreference', 'x'.repeat(4_097)]) {
    assert.throws(
      () => assertHospitalitySupplierReservationSubmissionAuthority(operation, {
        ...readyReview(),
        providerSubmissionReference,
      }),
      /authority changed/i,
    );
  }
});

test('rejects loyalty-required or unknown loyalty requirements until reservation payload authority carries loyalty data', () => {
  for (const customerLoyaltyRequiredAtReservation of [true, null]) {
    assert.throws(
      () => assertHospitalitySupplierReservationSubmissionAuthority(operation, {
        ...readyReview(),
        bookingTerms: {
          ...readyReview().bookingTerms!,
          customerLoyaltyRequiredAtReservation,
        },
      }),
      /authority changed/i,
    );
  }
});

test('rejects unsupported, contradictory, or incomplete fresh payment and guarantee semantics before create claim', () => {
  for (const bookingTerms of [
    { ...readyReview().bookingTerms!, guaranteeTypes: ['GUARANTEES_NOT_REQUIRED'] as const },
    { ...readyReview().bookingTerms!, guaranteeTypes: ['GUARANTEE_REQUIRED', 'PREPAY_REQUIRED'] as const },
    { ...readyReview().bookingTerms!, guaranteeTypes: ['GUARANTEE_REQUIRED', 'NO_GUARANTEES_ACCEPTED'] as const },
    { ...readyReview().bookingTerms!, guaranteeTypes: ['GUARANTEE_REQUIRED'] as const, paymentTiming: 'PREPAY' as const },
    { ...readyReview().bookingTerms!, guaranteeTypes: ['GUARANTEE_REQUIRED'] as const, paymentTiming: 'UNKNOWN' as const },
    { ...readyReview().bookingTerms!, guaranteeTypes: ['GUARANTEE_REQUIRED'] as const, acceptedPaymentCardCodes: [] },
    { ...readyReview().bookingTerms!, guaranteeTypes: ['DEPOSIT_REQUIRED'] as const, paymentTiming: 'PREPAY' as const, deposits: [] },
    {
      ...readyReview().bookingTerms!,
      guaranteeTypes: ['DEPOSIT_REQUIRED'] as const,
      paymentTiming: 'PREPAY' as const,
      deposits: [
        { remainder: null, dueDateLocal: null, money: { currency: 'USD', amountMinor: 50_000n } },
        { remainder: null, dueDateLocal: null, money: null },
      ],
    },
  ]) {
    assert.throws(
      () => assertHospitalitySupplierReservationSubmissionAuthority(operation, { ...readyReview(), bookingTerms }),
      /authority changed/i,
    );
  }
});

test('derives exact deposit amount from fresh Rules evidence only when payment timing agrees', () => {
  const result = assertHospitalitySupplierReservationSubmissionAuthority(operation, {
    ...readyReview(),
    bookingTerms: {
      ...readyReview().bookingTerms!,
      paymentTiming: 'PREPAY' as const,
      guaranteeTypes: ['DEPOSIT_REQUIRED'] as const,
      deposits: [{ remainder: null, dueDateLocal: null, money: { currency: 'USD', amountMinor: 50_000n } }],
    },
  });
  assert.deepEqual(result.paymentAuthority, {
    kind: 'DEPOSIT',
    collectionTiming: 'AT_BOOKING',
    currency: 'USD',
    amountMinor: 50_000n,
    acceptedPaymentCardCodes: ['VI'],
  });
});

test('rejects mismatched offer, terms, money and incomplete review evidence', () => {
  assert.throws(
    () => assertHospitalitySupplierReservationSubmissionAuthority(operation, {
      ...readyReview(),
      offer: { ...readyReview().offer!, offerFingerprint: 'f'.repeat(64) },
    }),
    /authority changed/i,
  );
  assert.throws(
    () => assertHospitalitySupplierReservationSubmissionAuthority(operation, {
      ...readyReview(),
      bookingTerms: { ...readyReview().bookingTerms!, termsFingerprint: 'f'.repeat(64) },
    }),
    /authority changed/i,
  );
  assert.throws(
    () => assertHospitalitySupplierReservationSubmissionAuthority(operation, {
      ...readyReview(),
      offer: { ...readyReview().offer!, price: { currency: 'USD', totalMinor: 125_501n } },
    }),
    /authority changed/i,
  );
  assert.throws(
    () => assertHospitalitySupplierReservationSubmissionAuthority(operation, {
      ...readyReview(),
      status: 'TERMS_INCOMPLETE',
      authorityFingerprint: null,
      providerSubmissionReference: null,
    }),
    /authority changed/i,
  );
});

test('legacy fingerprint versions fail before a fresh provider review can be trusted', () => {
  assert.throws(
    () => hospitalitySupplierReservationAuthorityInputFromOperation({ ...operation, requestFingerprintVersion: null }),
    /must be reviewed again/i,
  );
});
