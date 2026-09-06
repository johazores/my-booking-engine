import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HospitalitySupplierReservationConflictError,
  HospitalitySupplierReservationValidationError,
  assertHospitalitySupplierReservationCanReconcile,
  assertHospitalitySupplierReservationCanSubmit,
  assertHospitalitySupplierReservationExactRetry,
  hospitalitySupplierReservationRequestFingerprint,
  normalizeHospitalitySupplierReservationCorrelationId,
  normalizeHospitalitySupplierReservationFailureCode,
  normalizeHospitalitySupplierReservationIdempotencyKey,
  normalizeHospitalitySupplierReservationProviderReference,
  normalizeHospitalitySupplierReservationSelection,
} from './hospitality-supplier-reservation-domain.ts';

const selectionInput = {
  providerCode: 'Travelport-Stays',
  supplierPropertyReference: 'property_ref',
  supplierOfferReference: 'offer_ref',
  offerFingerprint: 'a'.repeat(64),
  termsFingerprint: 'b'.repeat(64),
  reservationAuthorityFingerprint: 'd'.repeat(64),
  reservationPayloadFingerprint: 'c'.repeat(64),
  currency: 'usd',
  expectedTotalMinor: 125_500n,
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-13',
  rooms: 1,
  adults: 2,
  childAges: [7],
} as const;

test('normalizes a bounded supplier reservation selection and produces a stable fingerprint', () => {
  const normalized = normalizeHospitalitySupplierReservationSelection(selectionInput);
  assert.equal(normalized.providerCode, 'travelport-stays');
  assert.equal(normalized.currency, 'USD');
  assert.equal(normalized.reservationAuthorityFingerprint, 'd'.repeat(64));
  assert.deepEqual(normalized.childAges, [7]);

  const fingerprint = hospitalitySupplierReservationRequestFingerprint(normalized);
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(fingerprint, hospitalitySupplierReservationRequestFingerprint(
    normalizeHospitalitySupplierReservationSelection({ ...selectionInput }),
  ));

  const payloadChanged = hospitalitySupplierReservationRequestFingerprint(
    normalizeHospitalitySupplierReservationSelection({ ...selectionInput, reservationPayloadFingerprint: 'e'.repeat(64) }),
  );
  assert.notEqual(payloadChanged, fingerprint);

  const authorityChanged = hospitalitySupplierReservationRequestFingerprint(
    normalizeHospitalitySupplierReservationSelection({ ...selectionInput, reservationAuthorityFingerprint: 'f'.repeat(64) }),
  );
  assert.notEqual(authorityChanged, fingerprint);
});

test('idempotency exact retries require the same complete request fingerprint', () => {
  const fingerprint = hospitalitySupplierReservationRequestFingerprint(
    normalizeHospitalitySupplierReservationSelection(selectionInput),
  );
  assert.doesNotThrow(() => assertHospitalitySupplierReservationExactRetry({ requestFingerprint: fingerprint }, fingerprint));
  assert.throws(
    () => assertHospitalitySupplierReservationExactRetry({ requestFingerprint: fingerprint }, 'c'.repeat(64)),
    HospitalitySupplierReservationConflictError,
  );
  assert.equal(normalizeHospitalitySupplierReservationIdempotencyKey(' supplier:create:0001 '), 'supplier:create:0001');
  assert.throws(() => normalizeHospitalitySupplierReservationIdempotencyKey('short'), HospitalitySupplierReservationValidationError);
});

test('create submission requires reviewed reservation authority while ambiguity still reconciles', () => {
  assert.doesNotThrow(() => assertHospitalitySupplierReservationCanSubmit({ status: 'PREPARED', lastFailureRetryable: null, requestFingerprintVersion: 2 }));
  assert.doesNotThrow(() => assertHospitalitySupplierReservationCanSubmit({ status: 'FAILED', lastFailureRetryable: true, requestFingerprintVersion: 2 }));
  assert.throws(
    () => assertHospitalitySupplierReservationCanSubmit({ status: 'PREPARED', lastFailureRetryable: null, requestFingerprintVersion: null }),
    /authority must be reviewed again/,
  );
  assert.throws(
    () => assertHospitalitySupplierReservationCanSubmit({ status: 'AMBIGUOUS', lastFailureRetryable: null, requestFingerprintVersion: null }),
    /must be reconciled/,
  );
  assert.doesNotThrow(() => assertHospitalitySupplierReservationCanReconcile('AMBIGUOUS'));
  assert.throws(() => assertHospitalitySupplierReservationCanReconcile('FAILED'), HospitalitySupplierReservationConflictError);
});

test('provider operational metadata is bounded and normalized without accepting raw multiline values', () => {
  assert.equal(normalizeHospitalitySupplierReservationProviderReference(' ABC-123 '), 'ABC-123');
  assert.equal(normalizeHospitalitySupplierReservationCorrelationId(' trace-1 '), 'trace-1');
  assert.equal(normalizeHospitalitySupplierReservationCorrelationId(null), null);
  assert.equal(normalizeHospitalitySupplierReservationFailureCode(' provider_unavailable '), 'PROVIDER_UNAVAILABLE');
  assert.throws(() => normalizeHospitalitySupplierReservationProviderReference('bad\nvalue'), HospitalitySupplierReservationValidationError);
  assert.throws(() => normalizeHospitalitySupplierReservationFailureCode('raw provider error with spaces'), HospitalitySupplierReservationValidationError);
});

test('selection rejects malformed authority, dates, money and occupancy before persistence', () => {
  assert.throws(
    () => normalizeHospitalitySupplierReservationSelection({ ...selectionInput, reservationAuthorityFingerprint: 'not-a-fingerprint' }),
    HospitalitySupplierReservationValidationError,
  );
  assert.throws(
    () => normalizeHospitalitySupplierReservationSelection({ ...selectionInput, departureDateLocal: '2026-10-10' }),
    HospitalitySupplierReservationValidationError,
  );
  assert.throws(
    () => normalizeHospitalitySupplierReservationSelection({ ...selectionInput, expectedTotalMinor: -1n }),
    HospitalitySupplierReservationValidationError,
  );
  assert.throws(
    () => normalizeHospitalitySupplierReservationSelection({ ...selectionInput, childAges: [18] }),
    HospitalitySupplierReservationValidationError,
  );
});
