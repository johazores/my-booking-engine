import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { TravelportStaysReservationCreateExecutor } from './travelport-stays-reservation-create-executor.ts';
import { TravelportStaysReservationRecoveryProvider } from './travelport-stays-reservation-recovery-provider.ts';
import { TravelportStaysReservationSyncExecutor } from './travelport-stays-reservation-sync-executor.ts';

const credentials = Object.freeze({
  environment: 'pre-production' as const,
  username: 'user',
  password: 'password',
  clientId: 'client',
  clientSecret: 'secret',
  accessGroup: 'group',
});

function rejectingGetter(message: string) {
  return {
    get requestCorrelationId(): string {
      throw new HospitalitySupplierProviderError('INVALID_REQUEST', message);
    },
  };
}

function fixedInvalidRequest(expectedMessage: string, forbiddenMessage: string) {
  return (error: unknown) => error instanceof HospitalitySupplierProviderError
    && error.code === 'INVALID_REQUEST'
    && error.message === expectedMessage
    && !error.message.includes(forbiddenMessage);
}

test('Create sanitizes caller-owned top-level accessor failures before provider I/O', async () => {
  let calls = 0;
  const executor = new TravelportStaysReservationCreateExecutor({
    credentials,
    cacheKey: 'operation-input-create',
    fetchImpl: (async () => {
      calls += 1;
      throw new Error('provider I/O must not run');
    }) as typeof fetch,
  });

  await assert.rejects(
    executor.createReservation(rejectingGetter('create caller secret') as never),
    fixedInvalidRequest(
      'Travelport reservation create operation authority could not be materialized safely.',
      'create caller secret',
    ),
  );
  assert.equal(calls, 0);
});

test('reviewed Create materializes accepted-review authority without rereading caller accessors', async () => {
  let reviewReads = 0;
  const acceptedReview = {
    get acceptPriceChange(): boolean {
      reviewReads += 1;
      throw new Error('review caller secret');
    },
    acceptGuaranteeChange: true,
  };
  const executor = new TravelportStaysReservationCreateExecutor({
    credentials,
    cacheKey: 'operation-input-reviewed-create',
    fetchImpl: (async () => {
      throw new Error('provider I/O must not run');
    }) as typeof fetch,
  });

  await assert.rejects(
    executor.createReservationAfterAcceptedReview({
      requestCorrelationId: '11111111-1111-4111-8111-111111111111',
      requestMaterial: {} as never,
      paymentAuthority: {} as never,
      acquirePaymentCard: async () => { throw new Error('card source must not run'); },
      expectedReservation: {} as never,
      beforeProviderRequest: async () => { throw new Error('marker must not run'); },
      acceptedReview,
    }),
    fixedInvalidRequest(
      'Travelport reviewed reservation acceptance authority could not be materialized safely.',
      'review caller secret',
    ),
  );
  assert.equal(reviewReads, 1);
});

test('Sync sanitizes caller-owned top-level accessor failures before provider I/O', async () => {
  let calls = 0;
  const executor = new TravelportStaysReservationSyncExecutor({
    credentials,
    cacheKey: 'operation-input-sync',
    fetchImpl: (async () => {
      calls += 1;
      throw new Error('provider I/O must not run');
    }) as typeof fetch,
  });

  await assert.rejects(
    executor.syncReservation(rejectingGetter('sync caller secret') as never),
    fixedInvalidRequest(
      'Travelport reservation Sync operation authority could not be materialized safely.',
      'sync caller secret',
    ),
  );
  assert.equal(calls, 0);
});

test('known-locator recovery sanitizes revoked and throwing caller authority before OAuth', async () => {
  let calls = 0;
  const provider = new TravelportStaysReservationRecoveryProvider({
    credentials,
    cacheKey: 'operation-input-recovery',
    fetchImpl: (async () => {
      calls += 1;
      throw new Error('provider I/O must not run');
    }) as typeof fetch,
  });

  await assert.rejects(
    provider.retrieveReservation(rejectingGetter('recovery caller secret') as never),
    fixedInvalidRequest(
      'Travelport reservation recovery operation authority could not be materialized safely.',
      'recovery caller secret',
    ),
  );

  const { proxy, revoke } = Proxy.revocable({
    providerReservationReference: 'D6VBHL',
    requestCorrelationId: '11111111-1111-4111-8111-111111111111',
    expectedReservation: {},
  }, {});
  revoke();
  await assert.rejects(
    provider.retrieveReservation(proxy as never),
    (error: unknown) => error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && error.message === 'Travelport reservation recovery operation authority could not be materialized safely.',
  );
  assert.equal(calls, 0);
});
