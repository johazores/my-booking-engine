import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { buildTravelportStaysReservationCreateRequestMaterial } from './travelport-stays-reservation-create-request-material.ts';

const MATERIALIZATION_FAILURE = 'Travelport reservation create request material authority could not be materialized safely.';

const canonicalTraveler = Object.freeze({
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  telephone: Object.freeze({
    countryCallingCode: '61',
    areaCode: '2',
    subscriberNumber: '98765432',
  }),
});

const canonicalPaymentAuthority = Object.freeze({
  kind: 'GUARANTEE' as const,
  collectionTiming: 'AT_PROPERTY' as const,
  currency: 'USD',
  amountMinor: 14337n,
  acceptedPaymentCardCodes: Object.freeze(['VI', 'MC']),
});

function invalidRequest(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST';
}

test('rejects two-character values that are not exact Travelport card-code machine tokens', () => {
  for (const code of ['vi', 'V!', '_V', 'ÅV']) {
    assert.throws(
      () => buildTravelportStaysReservationCreateRequestMaterial({
        providerSubmissionReference: 'offer-123',
        traveler: canonicalTraveler,
        paymentAuthority: {
          ...canonicalPaymentAuthority,
          acceptedPaymentCardCodes: [code],
        },
      }),
      invalidRequest,
    );
  }

  assert.doesNotThrow(() => buildTravelportStaysReservationCreateRequestMaterial({
    providerSubmissionReference: 'offer-123',
    traveler: canonicalTraveler,
    paymentAuthority: {
      ...canonicalPaymentAuthority,
      acceptedPaymentCardCodes: ['VI', '1A'],
    },
  }));
});

test('materializes top-level, traveler, telephone, payment, and card-code authority exactly once', () => {
  const reads = new Map<string, number>();
  const read = <T>(key: string, value: T) => {
    reads.set(key, (reads.get(key) ?? 0) + 1);
    return value;
  };

  const telephone = Object.create(null) as Record<string, unknown>;
  Object.defineProperties(telephone, {
    countryCallingCode: { enumerable: true, get: () => read('telephone.countryCallingCode', '61') },
    areaCode: { enumerable: true, get: () => read('telephone.areaCode', '2') },
    subscriberNumber: { enumerable: true, get: () => read('telephone.subscriberNumber', '98765432') },
  });

  const traveler = Object.create(null) as Record<string, unknown>;
  Object.defineProperties(traveler, {
    firstName: { enumerable: true, get: () => read('traveler.firstName', 'Ada') },
    lastName: { enumerable: true, get: () => read('traveler.lastName', 'Lovelace') },
    email: { enumerable: true, get: () => read('traveler.email', 'ada@example.com') },
    telephone: { enumerable: true, get: () => read('traveler.telephone', telephone) },
  });

  const cardCodes = new Proxy(['VI', 'MC'], {
    get(target, property, receiver) {
      if (property === 'length') return read('cards.length', Reflect.get(target, property, receiver));
      if (property === '0' || property === '1') return read(`cards.${property}`, Reflect.get(target, property, receiver));
      return Reflect.get(target, property, receiver);
    },
  });

  const paymentAuthority = Object.create(null) as Record<string, unknown>;
  Object.defineProperties(paymentAuthority, {
    kind: { enumerable: true, get: () => read('payment.kind', 'GUARANTEE') },
    collectionTiming: { enumerable: true, get: () => read('payment.collectionTiming', 'AT_PROPERTY') },
    currency: { enumerable: true, get: () => read('payment.currency', 'USD') },
    amountMinor: { enumerable: true, get: () => read('payment.amountMinor', 14337n) },
    acceptedPaymentCardCodes: { enumerable: true, get: () => read('payment.acceptedPaymentCardCodes', cardCodes) },
  });

  const input = Object.create(null) as Record<string, unknown>;
  Object.defineProperties(input, {
    providerSubmissionReference: { enumerable: true, get: () => read('input.providerSubmissionReference', 'offer-123') },
    traveler: { enumerable: true, get: () => read('input.traveler', traveler) },
    paymentAuthority: { enumerable: true, get: () => read('input.paymentAuthority', paymentAuthority) },
  });

  const material = buildTravelportStaysReservationCreateRequestMaterial(input as never);
  assert.equal(material.Payment[0].Amount.value, '143.37');
  assert.equal(material.Traveler[0].PersonName.Given, 'Ada');

  for (const [key, count] of reads) {
    assert.equal(count, 1, `${key} was read ${count} times`);
  }
});

test('sanitizes hostile top-level and nested authority access failures', () => {
  const secret = 'caller-secret-error-text';
  const hostileInput = new Proxy({
    providerSubmissionReference: 'offer-123',
    traveler: canonicalTraveler,
    paymentAuthority: canonicalPaymentAuthority,
  }, {
    get(target, property, receiver) {
      if (property === 'traveler') throw new Error(secret);
      return Reflect.get(target, property, receiver);
    },
  });

  assert.throws(
    () => buildTravelportStaysReservationCreateRequestMaterial(hostileInput),
    (error) => error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && error.message === MATERIALIZATION_FAILURE
      && !error.message.includes(secret),
  );

  const revoked = Proxy.revocable({ ...canonicalPaymentAuthority }, {});
  revoked.revoke();
  assert.throws(
    () => buildTravelportStaysReservationCreateRequestMaterial({
      providerSubmissionReference: 'offer-123',
      traveler: canonicalTraveler,
      paymentAuthority: revoked.proxy,
    } as never),
    (error) => error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && error.message === MATERIALIZATION_FAILURE,
  );
});

test('sanitizes hostile accepted-card collection and traveler telephone access failures', () => {
  const hostileCards = new Proxy(['VI'], {
    get(target, property, receiver) {
      if (property === '0') throw new Error('sensitive-card-authority-error');
      return Reflect.get(target, property, receiver);
    },
  });
  assert.throws(
    () => buildTravelportStaysReservationCreateRequestMaterial({
      providerSubmissionReference: 'offer-123',
      traveler: canonicalTraveler,
      paymentAuthority: {
        ...canonicalPaymentAuthority,
        acceptedPaymentCardCodes: hostileCards,
      },
    }),
    (error) => error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && error.message === MATERIALIZATION_FAILURE,
  );

  const hostileTelephone = new Proxy({ ...canonicalTraveler.telephone }, {
    get(target, property, receiver) {
      if (property === 'areaCode') throw new Error('sensitive-traveler-error');
      return Reflect.get(target, property, receiver);
    },
  });
  assert.throws(
    () => buildTravelportStaysReservationCreateRequestMaterial({
      providerSubmissionReference: 'offer-123',
      traveler: { ...canonicalTraveler, telephone: hostileTelephone },
      paymentAuthority: canonicalPaymentAuthority,
    }),
    (error) => error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && error.message === MATERIALIZATION_FAILURE,
  );
});
