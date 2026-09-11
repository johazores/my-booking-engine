import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  acquireTravelportStaysReservationPaymentCard,
  type TravelportStaysReservationPaymentCardSource,
  type TravelportStaysReservationPaymentCardSourceContext,
} from './travelport-stays-reservation-payment-card-source.ts';

const context: TravelportStaysReservationPaymentCardSourceContext = Object.freeze({
  organizationId: '11111111-1111-4111-8111-111111111111',
  reservationId: '22222222-2222-4222-8222-222222222222',
  integrationId: '33333333-3333-4333-8333-333333333333',
  integrationCredentialVersion: 3,
  attemptId: '44444444-4444-4444-8444-444444444444',
  purpose: 'INITIAL_CREATE',
});

const paymentCard = Object.freeze({
  cardType: 'Credit' as const,
  cardCode: 'VI',
  cardHolderName: 'Test Traveler',
  expireDate: '1230',
  cardNumber: '4'.repeat(16),
  securityCode: '1'.repeat(3),
});

test('payment source receives only normalized execution context and is called once', async () => {
  let calls = 0;
  let receivedContext: TravelportStaysReservationPaymentCardSourceContext | null = null;
  const source: TravelportStaysReservationPaymentCardSource = Object.freeze({
    async acquirePaymentCard(value) {
      calls += 1;
      receivedContext = value;
      return paymentCard;
    },
  });

  const result = await acquireTravelportStaysReservationPaymentCard(source, context);

  assert.equal(calls, 1);
  assert.notEqual(result, paymentCard);
  assert.deepEqual(result, paymentCard);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(receivedContext, context);
  assert.equal(Object.isFrozen(receivedContext), true);
  assert.deepEqual(Object.keys(receivedContext ?? {}).sort(), [
    'attemptId',
    'integrationCredentialVersion',
    'integrationId',
    'organizationId',
    'purpose',
    'reservationId',
  ]);
});

test('payment source materializes an allowlisted immutable snapshot and reads sensitive fields once', async () => {
  const reads = new Map<string, number>();
  const counted = (key: string, value: unknown) => ({
    enumerable: true,
    get() {
      reads.set(key, (reads.get(key) ?? 0) + 1);
      return value;
    },
  });
  const billingAddress = Object.defineProperties({}, {
    addressLine: counted('billingAddress.addressLine', '1 Test Street'),
    city: counted('billingAddress.city', 'Sydney'),
    stateProvince: counted('billingAddress.stateProvince', 'NSW'),
    countryCode: counted('billingAddress.countryCode', 'AU'),
    postalCode: counted('billingAddress.postalCode', '2000'),
    secretMetadata: counted('billingAddress.secretMetadata', 'must-not-propagate'),
  });
  const telephone = Object.defineProperties({}, {
    countryAccessCode: counted('telephone.countryAccessCode', '61'),
    areaCityCode: counted('telephone.areaCityCode', '2'),
    phoneNumber: counted('telephone.phoneNumber', '12345678'),
    cityCode: counted('telephone.cityCode', 'SYD'),
    secretMetadata: counted('telephone.secretMetadata', 'must-not-propagate'),
  });
  const sourceCard = Object.defineProperties({}, {
    cardType: counted('cardType', 'Credit'),
    cardCode: counted('cardCode', 'VI'),
    cardHolderName: counted('cardHolderName', 'Test Traveler'),
    expireDate: counted('expireDate', '1230'),
    cardNumber: counted('cardNumber', '4'.repeat(16)),
    securityCode: counted('securityCode', '111'),
    billingAddress: counted('billingAddress', billingAddress),
    telephone: counted('telephone', telephone),
    secretMetadata: counted('secretMetadata', 'must-not-propagate'),
  });

  const result = await acquireTravelportStaysReservationPaymentCard(Object.freeze({
    async acquirePaymentCard() {
      return sourceCard as never;
    },
  }), context);

  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result).sort(), [
    'billingAddress',
    'cardCode',
    'cardHolderName',
    'cardNumber',
    'cardType',
    'expireDate',
    'securityCode',
    'telephone',
  ]);
  assert.equal('secretMetadata' in result, false);
  assert.equal(Object.isFrozen(result.billingAddress), true);
  assert.equal(Object.isFrozen(result.telephone), true);
  assert.equal('secretMetadata' in (result.billingAddress ?? {}), false);
  assert.equal('secretMetadata' in (result.telephone ?? {}), false);
  for (const key of [
    'cardType',
    'cardCode',
    'cardHolderName',
    'expireDate',
    'cardNumber',
    'securityCode',
    'billingAddress',
    'telephone',
    'billingAddress.addressLine',
    'billingAddress.city',
    'billingAddress.stateProvince',
    'billingAddress.countryCode',
    'billingAddress.postalCode',
    'telephone.countryAccessCode',
    'telephone.areaCityCode',
    'telephone.phoneNumber',
    'telephone.cityCode',
  ]) {
    assert.equal(reads.get(key), 1, `${key} should be read exactly once`);
  }
  assert.equal(reads.has('secretMetadata'), false);
  assert.equal(reads.has('billingAddress.secretMetadata'), false);
  assert.equal(reads.has('telephone.secretMetadata'), false);
});

test('payment source fails closed when the capability or execution context is invalid', async () => {
  const cases = [
    [null, context],
    [{}, context],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, integrationCredentialVersion: 0 }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, integrationCredentialVersion: 2_147_483_648 }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, integrationCredentialVersion: Number.MAX_SAFE_INTEGER + 1 }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, purpose: 'UNKNOWN' }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, reservationId: ` ${context.reservationId}` }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, organizationId: 'organization-1' }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, reservationId: 'reservation-1' }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, integrationId: 'integration-1' }],
    [{ acquirePaymentCard: async () => paymentCard }, { ...context, attemptId: 'attempt-1' }],
  ] as const;

  for (const [source, invalidContext] of cases) {
    await assert.rejects(
      () => acquireTravelportStaysReservationPaymentCard(
        source as TravelportStaysReservationPaymentCardSource,
        invalidContext as TravelportStaysReservationPaymentCardSourceContext,
      ),
      (error: unknown) => (
        error instanceof HospitalitySupplierProviderError
        && error.code === 'INVALID_REQUEST'
        && error.retryable === false
      ),
    );
  }
});

test('payment source rejects an empty card result before the provider adapter is invoked', async () => {
  await assert.rejects(
    () => acquireTravelportStaysReservationPaymentCard(
      Object.freeze({
        async acquirePaymentCard() {
          return null as never;
        },
      }),
      context,
    ),
    (error: unknown) => (
      error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && error.retryable === false
    ),
  );
});

test('payment source failures preserve only normalized typed retry authority and never propagate source-controlled error text', async () => {
  const sensitive = 'external-source-sensitive-diagnostic';
  const mutatedTypedError = new HospitalitySupplierProviderError('TIMEOUT', sensitive);
  (mutatedTypedError as { code: string }).code = 'SOURCE_PRIVATE_CODE';
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();

  for (const [thrown, expectedCode, expectedRetryable] of [
    [new Error(sensitive), 'INVALID_REQUEST', false],
    [new HospitalitySupplierProviderError('TIMEOUT', sensitive), 'TIMEOUT', true],
    [mutatedTypedError, 'INVALID_REQUEST', false],
    [revocable.proxy, 'INVALID_REQUEST', false],
  ] as const) {
    await assert.rejects(
      () => acquireTravelportStaysReservationPaymentCard(Object.freeze({
        async acquirePaymentCard() { throw thrown; },
      }), context),
      (error: unknown) => {
        if (!(error instanceof HospitalitySupplierProviderError)) return false;
        assert.equal(error.code, expectedCode);
        assert.equal(error.retryable, expectedRetryable);
        assert.doesNotMatch(error.message, /external-source-sensitive-diagnostic/i);
        assert.match(error.message, /could not provide usable card material/i);
        return true;
      },
    );
  }
});

test('payment source sanitizes capability getter failures before acquisition', async () => {
  const source = Object.defineProperty({}, 'acquirePaymentCard', {
    get() {
      throw new HospitalitySupplierProviderError('PROVIDER_UNAVAILABLE', 'external-capability-sensitive-diagnostic');
    },
  });
  await assert.rejects(
    () => acquireTravelportStaysReservationPaymentCard(source as TravelportStaysReservationPaymentCardSource, context),
    (error: unknown) => {
      if (!(error instanceof HospitalitySupplierProviderError)) return false;
      assert.equal(error.code, 'PROVIDER_UNAVAILABLE');
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /external-capability-sensitive-diagnostic/i);
      return true;
    },
  );
});

test('payment source sanitizes top-level and nested result accessor failures before adapter validation', async () => {
  const sensitive = 'external-result-sensitive-diagnostic';
  const cases = [
    [Object.defineProperty({ ...paymentCard }, 'cardNumber', {
      enumerable: true,
      get() {
        throw new HospitalitySupplierProviderError('TIMEOUT', sensitive);
      },
    }), 'TIMEOUT', true],
    [{
      ...paymentCard,
      billingAddress: Object.defineProperty({
        addressLine: '1 Test Street',
        city: 'Sydney',
        countryCode: 'AU',
        postalCode: '2000',
      }, 'postalCode', {
        enumerable: true,
        get() {
          throw new Error(sensitive);
        },
      }),
    }, 'INVALID_REQUEST', false],
  ] as const;

  for (const [sourceCard, expectedCode, expectedRetryable] of cases) {
    await assert.rejects(
      () => acquireTravelportStaysReservationPaymentCard(Object.freeze({
        async acquirePaymentCard() {
          return sourceCard as never;
        },
      }), context),
      (error: unknown) => {
        if (!(error instanceof HospitalitySupplierProviderError)) return false;
        assert.equal(error.code, expectedCode);
        assert.equal(error.retryable, expectedRetryable);
        assert.doesNotMatch(error.message, /external-result-sensitive-diagnostic/i);
        assert.match(error.message, /could not provide usable card material/i);
        return true;
      },
    );
  }
});
