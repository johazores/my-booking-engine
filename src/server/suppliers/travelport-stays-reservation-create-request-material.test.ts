import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { buildTravelportStaysReservationCreateRequestMaterial } from './travelport-stays-reservation-create-request-material.ts';

const traveler = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  telephone: {
    countryCallingCode: '61',
    areaCode: '2',
    subscriberNumber: '98765432',
  },
} as const;

function paymentAuthority(kind: 'PREPAY' | 'DEPOSIT' | 'GUARANTEE') {
  return Object.freeze({
    kind,
    collectionTiming: kind === 'GUARANTEE' ? 'AT_PROPERTY' as const : 'AT_BOOKING' as const,
    currency: 'USD',
    amountMinor: kind === 'DEPOSIT' ? 5000n : 14337n,
    acceptedPaymentCardCodes: Object.freeze(['VI', 'MC']),
  });
}

test('maps fresh offer, canonical traveler and exact payment authority into non-secret Travelport request material', () => {
  assert.deepEqual(buildTravelportStaysReservationCreateRequestMaterial({
    providerSubmissionReference: 'offer-123',
    traveler,
    paymentAuthority: paymentAuthority('GUARANTEE'),
  }), {
    BuildFromCatalogOfferingHospitality: {
      '@type': 'BuildFromCatalogOfferingHospitality',
      CatalogOfferingIdentifier: { value: 'offer-123' },
    },
    Traveler: [{
      '@type': 'Traveler',
      PersonName: { Given: 'Ada', Surname: 'Lovelace' },
      Telephone: [{
        '@type': 'TelephoneDetail',
        countryAccessCode: '61',
        areaCityCode: '2',
        phoneNumber: '98765432',
      }],
      Email: [{ value: 'ada@example.com' }],
    }],
    Payment: [{
      '@type': 'Payment',
      Amount: { code: 'USD', value: '143.37' },
      guaranteeInd: true,
      depositInd: false,
    }],
  });
});

test('maps prepay and deposit authority to Travelport booking-time payment indicators', () => {
  for (const kind of ['PREPAY', 'DEPOSIT'] as const) {
    const material = buildTravelportStaysReservationCreateRequestMaterial({
      providerSubmissionReference: 'offer-123',
      traveler,
      paymentAuthority: paymentAuthority(kind),
    });
    assert.equal(material.Payment[0].depositInd, true);
    assert.equal(material.Payment[0].guaranteeInd, false);
  }
  assert.equal(
    buildTravelportStaysReservationCreateRequestMaterial({
      providerSubmissionReference: 'offer-123',
      traveler,
      paymentAuthority: paymentAuthority('DEPOSIT'),
    }).Payment[0].Amount.value,
    '50.00',
  );
});

test('fails closed instead of allowing Travelport to truncate a primary traveler name over 22 characters', () => {
  const exactLimit = buildTravelportStaysReservationCreateRequestMaterial({
    providerSubmissionReference: 'offer-123',
    traveler: { ...traveler, firstName: '12345678901', lastName: '12345678901' },
    paymentAuthority: paymentAuthority('GUARANTEE'),
  });
  assert.equal(exactLimit.Traveler[0].PersonName.Given.length + exactLimit.Traveler[0].PersonName.Surname.length, 22);

  assert.throws(
    () => buildTravelportStaysReservationCreateRequestMaterial({
      providerSubmissionReference: 'offer-123',
      traveler: { ...traveler, firstName: '123456789012', lastName: '12345678901' },
      paymentAuthority: paymentAuthority('GUARANTEE'),
    }),
    (error) => error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && /22 characters/i.test(error.message),
  );
});

test('rejects forged provider references and contradictory payment authority before request composition', () => {
  for (const invalid of [
    {
      providerSubmissionReference: ' offer-123 ',
      traveler,
      paymentAuthority: paymentAuthority('PREPAY'),
    },
    {
      providerSubmissionReference: 'offer-123',
      traveler,
      paymentAuthority: { ...paymentAuthority('PREPAY'), collectionTiming: 'AT_PROPERTY' as const },
    },
    {
      providerSubmissionReference: 'offer-123',
      traveler,
      paymentAuthority: { ...paymentAuthority('PREPAY'), acceptedPaymentCardCodes: ['VI', 'VI'] },
    },
  ]) {
    assert.throws(
      () => buildTravelportStaysReservationCreateRequestMaterial(invalid),
      (error) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
    );
  }
});

test('request material never contains form-of-payment card secrets', () => {
  const serialized = JSON.stringify(buildTravelportStaysReservationCreateRequestMaterial({
    providerSubmissionReference: 'offer-123',
    traveler,
    paymentAuthority: paymentAuthority('PREPAY'),
  }));
  assert.doesNotMatch(serialized, /FormOfPayment|CardNumber|SeriesCode|PlainText|CardHolderName|CVV/i);
});
