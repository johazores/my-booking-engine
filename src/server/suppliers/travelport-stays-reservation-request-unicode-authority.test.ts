import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeHospitalitySupplierReservationTravelerPayload,
} from './hospitality-supplier-reservation-traveler-authority.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type { HospitalitySupplierReservationPaymentAuthority } from './hospitality-supplier-reservation-payment-authority.ts';
import {
  buildTravelportStaysReservationCreateRequest,
  type TravelportStaysSensitiveReservationPaymentCard,
} from './travelport-stays-reservation-create-executor.ts';
import {
  buildTravelportStaysReservationCreateRequestMaterial,
  type TravelportStaysReservationCreateRequestMaterial,
} from './travelport-stays-reservation-create-request-material.ts';
import { buildTravelportStaysReservationSyncRequest } from './travelport-stays-reservation-sync-domain.ts';
import {
  createTravelportStaysSyncRecoveryReference,
  parseTravelportStaysSyncRecoveryReference,
  TravelportStaysSyncRecoveryReferenceError,
} from './travelport-stays-sync-recovery-reference.ts';

const traveler = Object.freeze({
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  telephone: Object.freeze({
    countryCallingCode: '61',
    areaCode: '2',
    subscriberNumber: '98765432',
  }),
});

const paymentAuthority: HospitalitySupplierReservationPaymentAuthority = Object.freeze({
  kind: 'GUARANTEE',
  collectionTiming: 'AT_PROPERTY',
  currency: 'USD',
  amountMinor: 14337n,
  acceptedPaymentCardCodes: Object.freeze(['VI']),
});

const requestMaterial: TravelportStaysReservationCreateRequestMaterial = Object.freeze({
  BuildFromCatalogOfferingHospitality: Object.freeze({
    '@type': 'BuildFromCatalogOfferingHospitality' as const,
    CatalogOfferingIdentifier: Object.freeze({ value: 'offer-123' }),
  }),
  Traveler: Object.freeze([Object.freeze({
    '@type': 'Traveler' as const,
    PersonName: Object.freeze({ Given: 'Ada', Surname: 'Lovelace' }),
    Telephone: Object.freeze([Object.freeze({
      '@type': 'TelephoneDetail' as const,
      countryAccessCode: '61',
      areaCityCode: '2',
      phoneNumber: '98765432',
    })]),
    Email: Object.freeze([Object.freeze({ value: 'ada@example.com' })]),
  })]),
  Payment: Object.freeze([Object.freeze({
    '@type': 'Payment' as const,
    Amount: Object.freeze({ code: 'USD', value: '143.37' }),
    guaranteeInd: true,
    depositInd: false,
  })]),
});

const paymentCard: TravelportStaysSensitiveReservationPaymentCard = Object.freeze({
  cardType: 'Credit',
  cardCode: 'VI',
  cardHolderName: 'Ada Lovelace',
  expireDate: '1230',
  cardNumber: '4111111111111111',
  securityCode: '123',
});

const invalidRequest = (error: unknown) => (
  error instanceof HospitalitySupplierProviderError
  && error.code === 'INVALID_REQUEST'
  && error.retryable === false
);

test('primary traveler authority rejects ill-formed UTF-16 before fingerprint or provider mapping', () => {
  for (const invalidTraveler of [
    { ...traveler, firstName: 'Ada\uD800' },
    { ...traveler, lastName: 'Love\uDC00lace' },
    { ...traveler, email: 'ada\uD800@example.com' },
  ]) {
    assert.doesNotThrow(() => JSON.stringify(invalidTraveler));
    assert.throws(
      () => normalizeHospitalitySupplierReservationTravelerPayload(invalidTraveler),
      /traveler|email/i,
    );
  }

  assert.equal(
    normalizeHospitalitySupplierReservationTravelerPayload({
      ...traveler,
      firstName: 'Ada 😀',
    }).firstName,
    'Ada 😀',
  );
});

test('Create request material rejects ill-formed supplier submission authority before serialization', () => {
  for (const providerSubmissionReference of ['offer-\uD800', 'offer-\uDC00']) {
    assert.doesNotThrow(() => JSON.stringify({ providerSubmissionReference }));
    assert.throws(
      () => buildTravelportStaysReservationCreateRequestMaterial({
        providerSubmissionReference,
        traveler,
        paymentAuthority,
      }),
      invalidRequest,
    );
  }
});

test('Create form-of-payment rejects ill-formed cardholder and billing text before durable provider marking', () => {
  for (const card of [
    { ...paymentCard, cardHolderName: 'Ada\uD800Lovelace' },
    {
      ...paymentCard,
      billingAddress: {
        addressLine: '125 Main\uDC00 St',
        city: 'Sydney',
        countryCode: 'AU',
        postalCode: '2000',
      },
    },
  ]) {
    assert.doesNotThrow(() => JSON.stringify(card));
    assert.throws(
      () => buildTravelportStaysReservationCreateRequest({
        requestMaterial,
        paymentAuthority,
        paymentCard: card,
        validThroughDateLocal: '2026-10-12',
        now: new Date('2026-09-13T00:00:00.000Z'),
      }),
      invalidRequest,
    );
  }
});

test('Booking.com Sync rejects ill-formed supplier confirmation and recovery authority before provider I/O', () => {
  for (const supplierConfirmationReference of ['T9RY0-\uD800', 'T9RY0-\uDC00']) {
    assert.throws(
      () => buildTravelportStaysReservationSyncRequest({
        providerRecoveryReference: 'travelport-stays-sync-v1:BKNG:BO',
        supplierConfirmationReference,
        traveler,
      }),
      /supplier confirmation is invalid/i,
    );
  }

  for (const offerAuthority of ['B\uD800KNG', 'B\uDC00KNG']) {
    assert.throws(
      () => createTravelportStaysSyncRecoveryReference({ offerAuthority, supplierSource: 'BO' }),
      TravelportStaysSyncRecoveryReferenceError,
    );
  }

  for (const reference of [
    'travelport-stays-sync-v1:B\uD800KNG:BO',
    'travelport-stays-sync-v1:B\uDC00KNG:BO',
  ]) {
    assert.throws(
      () => parseTravelportStaysSyncRecoveryReference(reference),
      TravelportStaysSyncRecoveryReferenceError,
    );
  }
});
