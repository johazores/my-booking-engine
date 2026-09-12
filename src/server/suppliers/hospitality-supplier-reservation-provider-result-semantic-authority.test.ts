import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  materializeHospitalitySupplierBookingTermsResult,
  materializeHospitalitySupplierOfferRevalidationResult,
  materializeHospitalitySupplierReservationAuthorityResult,
} from './hospitality-supplier-reservation-provider-result-authority.ts';

const fingerprint = 'a'.repeat(64);
const termsFingerprint = 'b'.repeat(64);

function offer(overrides: Record<string, unknown> = {}) {
  return {
    supplierPropertyReference: 'property-1',
    supplierOfferReference: 'offer-1',
    offerFingerprint: fingerprint,
    price: { currency: 'AUD', totalMinor: 14_337n },
    ...overrides,
  };
}

function bookingTerms(overrides: Record<string, unknown> = {}) {
  return {
    supplierPropertyReference: 'property-1',
    supplierOfferReference: 'offer-1',
    termsFingerprint,
    completeForReservationReview: true,
    revalidationRequired: true,
    paymentTiming: 'PREPAY',
    guaranteeTypes: ['PREPAY_REQUIRED'],
    customerLoyaltyRequiredAtReservation: false,
    deposits: [],
    acceptedPaymentCardCodes: ['VI', 'MC'],
    price: { currency: 'AUD', totalMinor: 14_337n },
    ...overrides,
  };
}

function assertInvalid(callback: () => unknown) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof HospitalitySupplierProviderError);
    assert.equal(error.code, 'INVALID_RESPONSE');
    assert.equal(error.message, 'Supplier reservation provider result could not be materialized safely.');
    return true;
  });
}

test('commercial offer evidence requires canonical references, fingerprint, ISO currency and bounded non-negative money', () => {
  const valid = materializeHospitalitySupplierOfferRevalidationResult({ status: 'UNCHANGED', offer: offer() });
  assert.equal(valid.offer?.price.totalMinor, 14_337n);

  for (const malformed of [
    offer({ supplierPropertyReference: ' property-1 ' }),
    offer({ supplierOfferReference: 'offer\n1' }),
    offer({ offerFingerprint: 'not-a-fingerprint' }),
    offer({ price: { currency: 'aud', totalMinor: 14_337n } }),
    offer({ price: { currency: 'AUD', totalMinor: -1n } }),
    offer({ price: { currency: 'AUD', totalMinor: 9_000_000_000_000_001n } }),
  ]) {
    assertInvalid(() => materializeHospitalitySupplierOfferRevalidationResult({ status: 'UNCHANGED', offer: malformed }));
  }
});

test('booking terms reject unknown or duplicate guarantee types and malformed accepted-card authority', () => {
  const valid = materializeHospitalitySupplierBookingTermsResult({
    status: 'READY',
    offer: offer(),
    bookingTerms: bookingTerms(),
  });
  assert.deepEqual(valid.bookingTerms?.guaranteeTypes, ['PREPAY_REQUIRED']);
  assert.deepEqual(valid.bookingTerms?.acceptedPaymentCardCodes, ['VI', 'MC']);

  assertInvalid(() => materializeHospitalitySupplierBookingTermsResult({
    status: 'READY', offer: offer(), bookingTerms: bookingTerms({ guaranteeTypes: ['FORGED_GUARANTEE'] }),
  }));
  assertInvalid(() => materializeHospitalitySupplierBookingTermsResult({
    status: 'READY', offer: offer(), bookingTerms: bookingTerms({ guaranteeTypes: ['PREPAY_REQUIRED', 'PREPAY_REQUIRED'] }),
  }));
  assertInvalid(() => materializeHospitalitySupplierBookingTermsResult({
    status: 'READY', offer: offer(), bookingTerms: bookingTerms({ acceptedPaymentCardCodes: ['VI', 'VI'] }),
  }));
  assertInvalid(() => materializeHospitalitySupplierBookingTermsResult({
    status: 'READY', offer: offer(), bookingTerms: bookingTerms({ acceptedPaymentCardCodes: [' VI'] }),
  }));
  assertInvalid(() => materializeHospitalitySupplierBookingTermsResult({
    status: 'READY', offer: offer(), bookingTerms: bookingTerms({ acceptedPaymentCardCodes: ['A'.repeat(17)] }),
  }));
});

test('deposit commercial evidence requires canonical local dates and bounded money', () => {
  const valid = materializeHospitalitySupplierBookingTermsResult({
    status: 'READY',
    offer: offer(),
    bookingTerms: bookingTerms({
      guaranteeTypes: ['DEPOSIT_REQUIRED'],
      deposits: [{ remainder: false, dueDateLocal: '2026-09-13', money: { currency: 'AUD', amountMinor: 5_000n } }],
    }),
  });
  assert.equal(valid.bookingTerms?.deposits[0]?.dueDateLocal, '2026-09-13');

  for (const deposit of [
    { remainder: false, dueDateLocal: '2026-02-31', money: { currency: 'AUD', amountMinor: 5_000n } },
    { remainder: false, dueDateLocal: '2026-09-13 ', money: { currency: 'AUD', amountMinor: 5_000n } },
    { remainder: false, dueDateLocal: '2026-09-13', money: { currency: 'aud', amountMinor: 5_000n } },
    { remainder: false, dueDateLocal: '2026-09-13', money: { currency: 'AUD', amountMinor: -1n } },
  ]) {
    assertInvalid(() => materializeHospitalitySupplierBookingTermsResult({
      status: 'READY',
      offer: offer(),
      bookingTerms: bookingTerms({ guaranteeTypes: ['DEPOSIT_REQUIRED'], deposits: [deposit] }),
    }));
  }
});

test('reservation authority requires canonical fingerprints, provider submission references and observation authority', () => {
  const valid = materializeHospitalitySupplierReservationAuthorityResult({
    status: 'READY',
    offer: offer(),
    bookingTerms: bookingTerms(),
    authorityFingerprint: 'c'.repeat(64),
    providerSubmissionReference: 'submission-1',
    observedAt: '2026-09-13T03:21:37.000Z',
    revalidationRequired: true,
  });
  assert.equal(valid.authorityFingerprint, 'c'.repeat(64));

  assertInvalid(() => materializeHospitalitySupplierReservationAuthorityResult({
    status: 'READY', offer: offer(), bookingTerms: bookingTerms(), authorityFingerprint: 'bad',
    providerSubmissionReference: 'submission-1', observedAt: '2026-09-13T03:21:37.000Z', revalidationRequired: true,
  }));
  assertInvalid(() => materializeHospitalitySupplierReservationAuthorityResult({
    status: 'READY', offer: offer(), bookingTerms: bookingTerms(), authorityFingerprint: 'c'.repeat(64),
    providerSubmissionReference: ' submission-1 ', observedAt: '2026-09-13T03:21:37.000Z', revalidationRequired: true,
  }));
  assertInvalid(() => materializeHospitalitySupplierReservationAuthorityResult({
    status: 'READY', offer: offer(), bookingTerms: bookingTerms(), authorityFingerprint: 'c'.repeat(64),
    providerSubmissionReference: 'submission-1', observedAt: 'x'.repeat(65), revalidationRequired: true,
  }));
});

test('new semantic validators preserve one-read branch behavior for nested authority', () => {
  const reads = new Map<string, number>();
  const once = <T>(name: string, value: T) => {
    reads.set(name, (reads.get(name) ?? 0) + 1);
    return value;
  };
  const result = materializeHospitalitySupplierBookingTermsResult({
    get status() { return once('status', 'READY'); },
    get offer() { return once('offer', offer()); },
    get bookingTerms() {
      return once('bookingTerms', {
        ...bookingTerms(),
        get guaranteeTypes() { return once('guaranteeTypes', ['PREPAY_REQUIRED']); },
        get acceptedPaymentCardCodes() { return once('acceptedPaymentCardCodes', ['VI']); },
        get deposits() { return once('deposits', []); },
      });
    },
  });
  assert.equal(result.status, 'READY');
  assert.deepEqual(Object.fromEntries(reads), {
    status: 1,
    offer: 1,
    bookingTerms: 1,
    guaranteeTypes: 1,
    acceptedPaymentCardCodes: 1,
    deposits: 1,
  });
});
