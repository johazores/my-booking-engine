import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readRentalPaymentSettlementHistory,
  RENTAL_PAYMENT_SETTLEMENT_MAX_TRANSACTIONS,
  RENTAL_PAYMENT_SETTLEMENT_PAGE_SIZE,
} from './rental-payment-history.ts';

function makeRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
    kind: index === 0 ? 'OFFLINE_PAYMENT' as const : 'REFUND' as const,
    status: 'SUCCEEDED' as const,
    providerCode: 'manual',
    providerReference: `REF-${index + 1}`,
    sourceProviderReference: index === 0 ? null : 'REF-1',
    currency: 'PHP',
    amountMinor: 1n,
  }));
}

type FindManyArgs = Readonly<{
  where: { organizationId: string; bookingId: string };
  take: number;
  cursor?: { id: string };
  skip?: number;
}>;

function createReader(rows: ReturnType<typeof makeRows>) {
  const calls: FindManyArgs[] = [];
  return {
    calls,
    transaction: {
      rentalPaymentTransaction: {
        async findMany(args: FindManyArgs) {
          calls.push(args);
          assert.deepEqual(args.where, { organizationId: 'org-1', bookingId: 'booking-1' });
          assert.ok(args.take <= RENTAL_PAYMENT_SETTLEMENT_PAGE_SIZE);
          let start = 0;
          if (args.cursor?.id) {
            const cursorIndex = rows.findIndex((row) => row.id === args.cursor.id);
            start = cursorIndex + Number(args.skip ?? 0);
          }
          return rows.slice(start, start + Number(args.take));
        },
      },
    },
  };
}

test('rental settlement history reads complete history through bounded tenant-scoped pages', async () => {
  const source = makeRows(205);
  const reader = createReader(source);
  const result = await readRentalPaymentSettlementHistory({
    transaction: reader.transaction as never,
    organizationId: 'org-1',
    bookingId: 'booking-1',
  });

  assert.equal(result.complete, true);
  assert.equal(result.complete ? result.transactions.length : -1, 205);
  assert.equal(reader.calls.length, 3);
  assert.ok(reader.calls.every((call) => Number(call.take) <= RENTAL_PAYMENT_SETTLEMENT_PAGE_SIZE));
});

test('rental settlement history fails closed beyond the reconciliation safety limit', async () => {
  const source = makeRows(RENTAL_PAYMENT_SETTLEMENT_MAX_TRANSACTIONS + 1);
  const reader = createReader(source);
  const result = await readRentalPaymentSettlementHistory({
    transaction: reader.transaction as never,
    organizationId: 'org-1',
    bookingId: 'booking-1',
  });

  assert.equal(result.complete, false);
  assert.match(result.complete ? '' : result.reason, /reconciliation safety limit/i);
  assert.equal(reader.calls.at(-1)?.take, 1);
});
