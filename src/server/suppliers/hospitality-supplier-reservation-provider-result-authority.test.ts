import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  materializeHospitalitySupplierBookingTermsResult,
  materializeHospitalitySupplierOfferRevalidationResult,
  materializeHospitalitySupplierReservationAuthorityResult,
} from './hospitality-supplier-reservation-provider-result-authority.ts';

function offer() {
  return {
    supplierPropertyReference: 'property',
    supplierOfferReference: 'offer',
    offerFingerprint: 'a'.repeat(64),
    price: { currency: 'AUD', totalMinor: 12345n, ignored: 'not copied' },
    ignored: 'not copied',
  };
}

function bookingTerms() {
  return {
    supplierPropertyReference: 'property',
    supplierOfferReference: 'offer',
    termsFingerprint: 'b'.repeat(64),
    completeForReservationReview: true,
    revalidationRequired: true,
    paymentTiming: 'PREPAY',
    guaranteeTypes: ['PREPAY_REQUIRED'],
    customerLoyaltyRequiredAtReservation: false,
    deposits: [],
    acceptedPaymentCardCodes: ['VI', 'MC'],
    price: { currency: 'AUD', totalMinor: 12345n },
    rawProviderSecret: 'must not be copied',
  };
}

function assertSanitized(callback: () => unknown) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof HospitalitySupplierProviderError);
    assert.equal(error.code, 'INVALID_RESPONSE');
    assert.equal(error.message, 'Supplier reservation provider result could not be materialized safely.');
    assert.doesNotMatch(error.message, /caller secret/i);
    return true;
  });
}

test('reservation authority snapshots only commercial write evidence and freezes nested authority', () => {
  const source = {
    status: 'READY',
    offer: offer(),
    bookingTerms: bookingTerms(),
    authorityFingerprint: 'c'.repeat(64),
    providerSubmissionReference: 'submission',
    observedAt: '2026-09-13T00:00:00.000Z',
    revalidationRequired: true,
    rawProviderPayload: 'must not be copied',
  };

  const snapshot = materializeHospitalitySupplierReservationAuthorityResult(source);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.offer), true);
  assert.equal(Object.isFrozen(snapshot.offer?.price), true);
  assert.equal(Object.isFrozen(snapshot.bookingTerms), true);
  assert.equal(Object.isFrozen(snapshot.bookingTerms?.guaranteeTypes), true);
  assert.equal(Object.isFrozen(snapshot.bookingTerms?.acceptedPaymentCardCodes), true);
  assert.equal('rawProviderPayload' in snapshot, false);
  assert.equal('rawProviderSecret' in (snapshot.bookingTerms as object), false);
  assert.equal('ignored' in (snapshot.offer as object), false);

  source.offer.price.totalMinor = 99999n;
  source.bookingTerms.acceptedPaymentCardCodes[0] = 'AX';
  assert.equal(snapshot.offer?.price.totalMinor, 12345n);
  assert.deepEqual(snapshot.bookingTerms?.acceptedPaymentCardCodes, ['VI', 'MC']);
});

test('provider result fields are read once and later caller mutation cannot change the snapshot', () => {
  let statusReads = 0;
  let offerReads = 0;
  const result = {
    get status() { statusReads += 1; return 'UNCHANGED'; },
    get offer() { offerReads += 1; return offer(); },
  };
  const snapshot = materializeHospitalitySupplierOfferRevalidationResult(result);
  assert.equal(snapshot.status, 'UNCHANGED');
  assert.equal(statusReads, 1);
  assert.equal(offerReads, 1);
});

test('nested commercial authority fields are read once before validation and freezing', () => {
  const reads = new Map<string, number>();
  const once = <T>(name: string, value: T) => ({
    get value() {
      reads.set(name, (reads.get(name) ?? 0) + 1);
      return value;
    },
  });
  const property = once('property', 'property');
  const offerReference = once('offer', 'offer');
  const offerFingerprint = once('offerFingerprint', 'a'.repeat(64));
  const offerCurrency = once('offerCurrency', 'AUD');
  const offerTotal = once('offerTotal', 12345n);
  const termsProperty = once('termsProperty', 'property');
  const termsOffer = once('termsOffer', 'offer');
  const termsFingerprint = once('termsFingerprint', 'b'.repeat(64));
  const complete = once('complete', true);
  const revalidation = once('termsRevalidation', true);
  const paymentTiming = once('paymentTiming', 'PREPAY');
  const guaranteeTypes = once('guaranteeTypes', ['PREPAY_REQUIRED']);
  const loyalty = once('loyalty', false);
  const deposits = once('deposits', []);
  const cards = once('cards', ['VI']);
  const termsCurrency = once('termsCurrency', 'AUD');
  const termsTotal = once('termsTotal', 12345n);
  const authorityFingerprint = once('authorityFingerprint', 'c'.repeat(64));
  const submissionReference = once('submissionReference', 'submission');
  const observedAt = once('observedAt', '2026-09-13T00:00:00.000Z');
  const resultRevalidation = once('resultRevalidation', true);

  const snapshot = materializeHospitalitySupplierReservationAuthorityResult({
    status: 'READY',
    offer: {
      get supplierPropertyReference() { return property.value; },
      get supplierOfferReference() { return offerReference.value; },
      get offerFingerprint() { return offerFingerprint.value; },
      get price() {
        return {
          get currency() { return offerCurrency.value; },
          get totalMinor() { return offerTotal.value; },
        };
      },
    },
    bookingTerms: {
      get supplierPropertyReference() { return termsProperty.value; },
      get supplierOfferReference() { return termsOffer.value; },
      get termsFingerprint() { return termsFingerprint.value; },
      get completeForReservationReview() { return complete.value; },
      get revalidationRequired() { return revalidation.value; },
      get paymentTiming() { return paymentTiming.value; },
      get guaranteeTypes() { return guaranteeTypes.value; },
      get customerLoyaltyRequiredAtReservation() { return loyalty.value; },
      get deposits() { return deposits.value; },
      get acceptedPaymentCardCodes() { return cards.value; },
      get price() {
        return {
          get currency() { return termsCurrency.value; },
          get totalMinor() { return termsTotal.value; },
        };
      },
    },
    get authorityFingerprint() { return authorityFingerprint.value; },
    get providerSubmissionReference() { return submissionReference.value; },
    get observedAt() { return observedAt.value; },
    get revalidationRequired() { return resultRevalidation.value; },
  });

  assert.equal(snapshot.offer?.price.totalMinor, 12345n);
  assert.equal(snapshot.bookingTerms?.termsFingerprint, 'b'.repeat(64));
  for (const [name, count] of reads) assert.equal(count, 1, `${name} must be read once`);
});

test('booking terms snapshot freezes payment arrays and deposit money', () => {
  const result = materializeHospitalitySupplierBookingTermsResult({
    status: 'READY',
    offer: offer(),
    bookingTerms: {
      ...bookingTerms(),
      guaranteeTypes: ['DEPOSIT_REQUIRED'],
      paymentTiming: 'PREPAY',
      deposits: [{ remainder: false, dueDateLocal: '2026-09-13', money: { currency: 'AUD', amountMinor: 5000n } }],
    },
  });
  assert.equal(Object.isFrozen(result.bookingTerms?.deposits), true);
  assert.equal(Object.isFrozen(result.bookingTerms?.deposits[0]), true);
  assert.equal(Object.isFrozen(result.bookingTerms?.deposits[0]?.money), true);
  assert.equal(result.bookingTerms?.deposits[0]?.money?.amountMinor, 5000n);
});

test('throwing getters, revoked proxies, malformed status and malformed nested arrays fail with a fixed response error', () => {
  assertSanitized(() => materializeHospitalitySupplierOfferRevalidationResult({
    get status() { throw new Error('caller secret'); },
    offer: null,
  }));

  const { proxy, revoke } = Proxy.revocable({ status: 'UNCHANGED', offer: offer() }, {});
  revoke();
  assertSanitized(() => materializeHospitalitySupplierOfferRevalidationResult(proxy));

  assertSanitized(() => materializeHospitalitySupplierOfferRevalidationResult({ status: 'MAYBE', offer: null }));
  assertSanitized(() => materializeHospitalitySupplierBookingTermsResult({
    status: 'READY',
    offer: offer(),
    bookingTerms: { ...bookingTerms(), acceptedPaymentCardCodes: { 0: 'VI', length: 1 } },
  }));
});
