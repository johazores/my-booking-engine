import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { TravelportStaysReservationSyncExecutor } from './travelport-stays-reservation-sync-executor.ts';
import type { TravelportStaysCreateExpectedReservation } from './travelport-stays-reservation-create-outcome.ts';

const credentials = Object.freeze({
  environment: 'pre-production' as const,
  username: 'sync-user',
  password: 'sync-password',
  clientId: 'sync-client',
  clientSecret: 'sync-secret',
  accessGroup: 'sync-group',
});

const expectedReservation: TravelportStaysCreateExpectedReservation = Object.freeze({
  chainCode: 'HI',
  propertyCode: 'ABC12',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 2,
});

function invalidRequest(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST';
}

test('Sync rejects malformed expected reservation authority before OAuth or provider marking', async () => {
  const invalidExpectations: unknown[] = [
    null,
    { ...expectedReservation, chainCode: 'HI\t' },
    { ...expectedReservation, propertyCode: 'ABC\u0000' },
    { ...expectedReservation, arrivalDateLocal: '2026-02-30' },
    { ...expectedReservation, departureDateLocal: expectedReservation.arrivalDateLocal },
    { ...expectedReservation, rooms: 2 },
    { ...expectedReservation, guests: 0 },
    { ...expectedReservation, guests: 10 },
  ];

  for (const [index, invalidExpectation] of invalidExpectations.entries()) {
    let fetchCalls = 0;
    let marked = false;
    const executor = new TravelportStaysReservationSyncExecutor({
      credentials,
      cacheKey: `sync-expected-authority-${index}`,
      fetchImpl: (async () => {
        fetchCalls += 1;
        throw new Error('provider I/O must not occur');
      }) as typeof fetch,
    });

    await assert.rejects(
      executor.syncReservation({
        requestCorrelationId: '13b6a693-31e8-4a0d-895c-d0f620dbd1fa',
        providerRecoveryReference: 'unused-before-identity-validation',
        supplierConfirmationReference: 'unused-before-identity-validation',
        traveler: {} as never,
        expectedReservation: invalidExpectation as TravelportStaysCreateExpectedReservation,
        beforeProviderRequest: async () => { marked = true; },
      }),
      invalidRequest,
    );
    assert.equal(fetchCalls, 0);
    assert.equal(marked, false);
  }
});

test('Sync cache keys reject embedded ASCII control characters', () => {
  for (const cacheKey of ['sync\tcache', 'sync\u0000cache', 'sync\u001fcache', 'sync\u007fcache']) {
    assert.throws(
      () => new TravelportStaysReservationSyncExecutor({ credentials, cacheKey }),
      invalidRequest,
    );
  }
});
