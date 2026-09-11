import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { acquireTravelportStaysReservationPaymentCard } from './travelport-stays-reservation-payment-card-source.ts';

const card = Object.freeze({
  cardType: 'Credit' as const,
  cardCode: 'VI',
  cardHolderName: 'Test Traveler',
  expireDate: '1230',
  cardNumber: '4'.repeat(16),
  securityCode: '111',
});

const contextValues = Object.freeze({
  organizationId: '11111111-1111-4111-8111-111111111111',
  reservationId: '22222222-2222-4222-8222-222222222222',
  integrationId: '33333333-3333-4333-8333-333333333333',
  integrationCredentialVersion: 3,
  attemptId: '44444444-4444-4444-8444-444444444444',
  purpose: 'INITIAL_CREATE',
});

test('materializes source execution context once and excludes unrelated caller fields', async () => {
  const reads = new Map<string, number>();
  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(contextValues)) {
    Object.defineProperty(context, key, {
      enumerable: true,
      get() {
        reads.set(key, (reads.get(key) ?? 0) + 1);
        return value;
      },
    });
  }
  Object.defineProperty(context, 'secretMetadata', {
    enumerable: true,
    get() {
      throw new Error('must-not-be-read');
    },
  });

  let received: unknown;
  await acquireTravelportStaysReservationPaymentCard({
    async acquirePaymentCard(value) {
      received = value;
      return card;
    },
  }, context as never);

  assert.deepEqual(received, contextValues);
  assert.equal(Object.isFrozen(received), true);
  assert.equal('secretMetadata' in (received as Record<string, unknown>), false);
  for (const key of Object.keys(contextValues)) assert.equal(reads.get(key), 1, key);
});

test('fails closed without leaking caller-controlled context accessor diagnostics', async () => {
  const context = Object.defineProperty({ ...contextValues }, 'reservationId', {
    enumerable: true,
    get() {
      throw new Error('caller-context-sensitive-diagnostic');
    },
  });

  await assert.rejects(
    () => acquireTravelportStaysReservationPaymentCard({
      async acquirePaymentCard() { return card; },
    }, context as never),
    (error: unknown) => {
      if (!(error instanceof HospitalitySupplierProviderError)) return false;
      assert.equal(error.code, 'INVALID_REQUEST');
      assert.equal(error.retryable, false);
      assert.match(error.message, /source context is invalid/i);
      assert.doesNotMatch(error.message, /caller-context-sensitive-diagnostic/i);
      return true;
    },
  );
});

test('rejects array capability objects before acquisition', async () => {
  const source = [] as unknown as { acquirePaymentCard: () => Promise<typeof card> };
  source.acquirePaymentCard = async () => card;
  await assert.rejects(
    () => acquireTravelportStaysReservationPaymentCard(source as never, contextValues as never),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );
});
