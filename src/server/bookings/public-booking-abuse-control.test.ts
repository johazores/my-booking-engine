import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enforcePublicBookingHoldCreationLimit,
  PUBLIC_BOOKING_MAX_ACTIVE_HOLDS_PER_ORGANIZATION,
  PUBLIC_BOOKING_MAX_ROOMS_PER_HOLD,
  PublicBookingAbuseLimitError,
  PublicBookingHoldQuantityValidationError,
} from './public-booking-abuse-control.ts';

function transactionStub(options?: {
  existing?: boolean;
  activeCount?: number;
  earliestExpiry?: Date | null;
}) {
  let aggregateCalls = 0;
  const aggregateQueries: unknown[] = [];
  let lockCalls = 0;
  const lookups: unknown[] = [];
  const transaction = {
    $queryRaw: async () => { lockCalls += 1; return []; },
    hospitalityAvailabilityHold: {
      findUnique: async (query: unknown) => {
        lookups.push(query);
        return options?.existing ? { id: 'hold' } : null;
      },
    },
    publicBookingPrincipal: {
      aggregate: async (query: unknown) => {
        aggregateQueries.push(query);
        aggregateCalls += 1;
        return {
          _count: { _all: options?.activeCount ?? 0 },
          _min: { expiresAt: options?.earliestExpiry ?? null },
        };
      },
    },
  };
  return { transaction, aggregateCalls: () => aggregateCalls, aggregateQueries, lockCalls: () => lockCalls, lookups };
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
    (error: unknown) => {
      assert.ok(error instanceof PublicBookingHoldQuantityValidationError);
      assert.match(error.message, /at most 4 rooms/);
      return true;
    },
  );
  assert.equal(stub.aggregateCalls(), 0);
  assert.equal(stub.lockCalls(), 1);
  assert.deepEqual(stub.lookups, [{
    where: {
      organizationId_idempotencyKey: {
        organizationId: '11111111-1111-4111-8111-111111111111',
        idempotencyKey: 'public-hold:test',
      },
    },
    select: { id: true },
  }]);
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

test('existing hold request keys reach canonical idempotency comparison even if a changed retry exceeds the room limit', async () => {
  const stub = transactionStub({
    existing: true,
    activeCount: PUBLIC_BOOKING_MAX_ACTIVE_HOLDS_PER_ORGANIZATION,
    earliestExpiry: new Date(now.getTime() + 60_000),
  });
  await enforcePublicBookingHoldCreationLimit(guardInput(stub.transaction, { quantity: PUBLIC_BOOKING_MAX_ROOMS_PER_HOLD + 1 }));
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

test('anonymous hold ceiling excludes settled/cancelled booking principals but preserves unresolved and unconfirmed ones', async () => {
  const stub = transactionStub({ activeCount: PUBLIC_BOOKING_MAX_ACTIVE_HOLDS_PER_ORGANIZATION - 1 });
  await enforcePublicBookingHoldCreationLimit(guardInput(stub.transaction));
  assert.deepEqual(stub.aggregateQueries, [{
    where: {
      organizationId: '11111111-1111-4111-8111-111111111111',
      expiresAt: { gt: now },
      OR: [
        { bookingOwnerships: { none: {} } },
        {
          bookingOwnerships: {
            some: {
              booking: {
                status: { not: 'CANCELLED' },
                paymentStatus: { in: ['UNPAID', 'AUTHORIZED', 'FAILED'] },
              },
            },
          },
        },
      ],
    },
    _count: { _all: true },
    _min: { expiresAt: true },
  }]);
});
