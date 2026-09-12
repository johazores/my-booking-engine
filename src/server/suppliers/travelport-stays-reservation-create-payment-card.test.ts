import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type { HospitalitySupplierReservationPaymentAuthority } from './hospitality-supplier-reservation-payment-authority.ts';
import type { TravelportStaysReservationCreateRequestMaterial } from './travelport-stays-reservation-create-request-material.ts';
import {
  buildTravelportStaysReservationCreateRequest,
  type TravelportStaysSensitiveReservationPaymentCard,
} from './travelport-stays-reservation-create-executor.ts';

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

const paymentAuthority: HospitalitySupplierReservationPaymentAuthority = Object.freeze({
  kind: 'GUARANTEE' as const,
  collectionTiming: 'AT_PROPERTY' as const,
  currency: 'USD',
  amountMinor: 14337n,
  acceptedPaymentCardCodes: Object.freeze(['VI', 'MC']),
});

const paymentCard: TravelportStaysSensitiveReservationPaymentCard = Object.freeze({
  cardType: 'Credit' as const,
  cardCode: 'VI',
  cardHolderName: 'Ada Lovelace',
  expireDate: '1227',
  cardNumber: '4111111111111111',
  securityCode: '123',
});

function build(
  card: TravelportStaysSensitiveReservationPaymentCard = paymentCard,
  validThroughDateLocal = '2026-10-12',
) {
  return buildTravelportStaysReservationCreateRequest({
    requestMaterial,
    paymentAuthority,
    paymentCard: card,
    validThroughDateLocal,
    now: new Date('2026-09-07T00:00:00.000Z'),
  });
}

test('maps optional payment-card billing address and telephone only into the ephemeral Travelport form of payment', () => {
  const request = build({
    ...paymentCard,
    billingAddress: {
      addressLine: '125 Billing Address Street',
      city: 'Claremont',
      stateProvince: 'CA',
      countryCode: 'US',
      postalCode: '91711-3323',
    },
    telephone: {
      countryAccessCode: '1',
      areaCityCode: '909',
      phoneNumber: '1231234',
      cityCode: 'DEN',
    },
  });
  const card = request.ReservationQueryBuild.ReservationBuild.FormOfPayment[0].PaymentCard;

  assert.deepEqual(card.Address, {
    '@type': 'AddressDetail',
    AddressLine: ['125 Billing Address Street'],
    City: 'Claremont',
    StateProv: { value: 'CA' },
    Country: { value: 'US' },
    PostalCode: '91711-3323',
  });
  assert.deepEqual(card.Telephone, [{
    '@type': 'TelephoneDetail',
    countryAccessCode: '1',
    areaCityCode: '909',
    phoneNumber: '1231234',
    cityCode: 'DEN',
  }]);
});

test('requires provider-compatible card code, bounded numeric PAN, and expiry through the stay before provider I/O', () => {
  for (const card of [
    { ...paymentCard, cardCode: 'VISA' },
    { ...paymentCard, cardNumber: '41111111111111111111' },
    { ...paymentCard, expireDate: '0926' },
  ]) {
    assert.throws(
      () => build(card),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
    );
  }
});

test('rejects malformed direct accepted-card authority even when the selected card matches it', () => {
  for (const acceptedPaymentCardCodes of [
    ['V'],
    ['VISA'],
    ['VI', 'V'],
    ['VI', 'VI'],
    [' VI'],
  ]) {
    assert.throws(
      () => buildTravelportStaysReservationCreateRequest({
        requestMaterial,
        paymentAuthority: { ...paymentAuthority, acceptedPaymentCardCodes },
        paymentCard: { ...paymentCard, cardCode: acceptedPaymentCardCodes[0] ?? 'VI' },
        validThroughDateLocal: '2026-10-12',
        now: new Date('2026-09-07T00:00:00.000Z'),
      }),
      (error: unknown) => error instanceof HospitalitySupplierProviderError
        && error.code === 'INVALID_REQUEST'
        && /accepted-card authority/i.test(error.message),
    );
  }
});

test('fails closed on ASCII controls in provider-bound cardholder and billing text', () => {
  for (const card of [
    { ...paymentCard, cardHolderName: 'Ada\u0000Lovelace' },
    { ...paymentCard, cardHolderName: 'Ada\tLovelace' },
    { ...paymentCard, billingAddress: { addressLine: '125 Main\u001fSt', city: 'Sydney', countryCode: 'AU', postalCode: '2000' } },
    { ...paymentCard, billingAddress: { addressLine: '125 Main St', city: 'Syd\u0000ney', stateProvince: 'NSW', countryCode: 'AU', postalCode: '2000' } },
    { ...paymentCard, billingAddress: { addressLine: '125 Main St', city: 'Sydney', stateProvince: 'N\u007fSW', countryCode: 'AU', postalCode: '2000' } },
    { ...paymentCard, billingAddress: { addressLine: '125 Main St', city: 'Sydney', countryCode: 'AU', postalCode: '20\u001f00' } },
  ]) {
    assert.throws(
      () => build(card),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
    );
  }
});

test('fails closed on malformed optional billing and payment-phone material', () => {
  for (const card of [
    { ...paymentCard, billingAddress: { addressLine: '125 Main St', city: 'Sydney', countryCode: 'au', postalCode: '2000' } },
    { ...paymentCard, billingAddress: { addressLine: '125 Main St\nSuite 2', city: 'Sydney', countryCode: 'AU', postalCode: '2000' } },
    { ...paymentCard, telephone: { countryAccessCode: '+61', areaCityCode: '2', phoneNumber: '98765432' } },
    { ...paymentCard, telephone: { countryAccessCode: '61', areaCityCode: '2', phoneNumber: '98765432', cityCode: 'SYDNEY-LONG' } },
  ]) {
    assert.throws(
      () => build(card),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
    );
  }
});
