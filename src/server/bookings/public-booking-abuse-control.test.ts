import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enforcePublicBookingHoldCreationLimit,
  PUBLIC_BOOKING_MAX_ACTIVE_HOLDS_PER_ORGANIZATION,
  PUBLIC_BOOKING_MAX_ROOMS_PER_HOLD,
  PublicBookingAbuseLimitError,
} from './public-booking-abuse-control.ts';

function transactionStub(options?: {
  existing?: boolean;
  activeCount?: number;
  earliestExpiry?: Date | null;
}) {
  let aggregateCalls = 0;
  const transaction = {
    $queryRaw: async () => [],
    hospitalityAvailabilityHold: {
      findUnique: async () => options?.existing ? { id: 'hold' } : null,
    },
    publicBookingPrincipal: {
      aggregate: async () => {
        aggregateCalls += 1;
        return {
          _count: { _all: options?.activeCount ?? 0 },
          _min: { expiresAt: options?.earliestExpiry ?? null },
        };
      },
    },
  };
  return { transaction, aggregateCalls: () => aggregateCalls };
}

const now = new Date('2026-09-02T06:00:00.000Z');

function guardInput(transaction: unknown, overrides?: { quantity?: number }) {
  return {
    transaction: transaction as never,
    organizationId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: 'public-hold:test',
    quantity: overrides?.quantity ?? 1,
    now,
  };
}

test('public booking hold guard rejects oversized anonymous holds before database allocation work', async () => {
  const stub = transactionStub();
  await assert.rejects(
    enforcePublicBookingHoldCreationLimit(guardInput(stub.transaction, { quantity: PUBLIC_BOOKING_MAX_ROOMS_PER_HOLD + 1 })),
    { name: 'RangeError' },
  );
  assert.equal(stub.aggregateCalls(), 0);
});

test('public booking hold guard preserves canonical idempotency behavior at the tenant ceiling', async () => {
  const stub = transactionStub({
    existing: true,
    activeCount: PUBLIC_BOOKING_MAX_ACTIVE_HOLDS_PER_ORGANIZATION,
    earliestExpiry: new Date(now.getTime() + 60_000),
  });
  await enforcePublicBookingHoldCreationLimit(guardInput(stub.transaction));
  assert.equal(stub.aggregateCalls(), 0);
});

test('public booking hold guard allows new work below the durable tenant ceiling', async () => {
  const stub = transactionStub({ activeCount: PUBLIC_BOOKING_MAX_ACTIVE_HOLDS_PER_ORGANIZATION - 1 });
  await enforcePublicBookingHoldCreationLimit(guardInput(stub.transaction));
  assert.equal(stub.aggregateCalls(), 1);
});

test('public booking hold guard returns a bounded retry delay when tenant capacity is exhausted', async () => {
  const stub = transactionStub({
    activeCount: PUBLIC_BOOKING_MAX_ACTIVE_HOLDS_PER_ORGANIZATION,
    earliestExpiry: new Date(now.getTime() + 90_500),
  });
  await assert.rejects(
    enforcePublicBookingHoldCreationLimit(guardInput(stub.transaction)),
    (error: unknown) => {
      assert.ok(error instanceof PublicBookingAbuseLimitError);
      assert.equal(error.retryAfterSeconds, 91);
      return true;
    },
  );
});
