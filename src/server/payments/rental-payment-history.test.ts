import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRentalPaymentIdempotencyKey, buildRentalPaymentRequestFingerprint } from './rental-payment-domain.ts';
import {
  readRentalPaymentSettlementHistory,
  RENTAL_PAYMENT_SETTLEMENT_MAX_TRANSACTIONS,
  RENTAL_PAYMENT_SETTLEMENT_PAGE_SIZE,
} from './rental-payment-history.ts';

const organizationId = 'org-1';
const bookingId = 'booking-1';

function makeRows(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const kind = index === 0 ? 'OFFLINE_PAYMENT' as const : 'REFUND' as const;
    const providerReference = `REF-${index + 1}`;
    const sourceProviderReference = index === 0 ? null : 'REF-1';
    const idempotencyKey = buildRentalPaymentIdempotencyKey({
      kind: kind === 'OFFLINE_PAYMENT' ? 'manual-payment' : 'manual-refund',
      bookingId,
      reference: providerReference,
    });
    const requestFingerprint = buildRentalPaymentRequestFingerprint({
      organizationId,
      bookingId,
      idempotencyKey,
      kind,
      providerCode: 'manual',
      providerReference,
      sourceProviderReference,
      currency: 'PHP',
      amountMinor: 1n,
    });
    return {
      id: `${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
      organizationId,
      bookingId,
      idempotencyKey,
      requestFingerprint,
      kind,
      status: 'SUCCEEDED' as const,
      providerCode: 'manual',
      providerReference,
      sourceProviderReference,
      currency: 'PHP',
      amountMinor: 1n,
      createdAt: new Date(Date.UTC(2026, 8, 16, 0, index)),
    };
  });
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
          assert.deepEqual(args.where, { organizationId, bookingId });
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
    organizationId,
    bookingId,
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
    organizationId,
    bookingId,
  });

  assert.equal(result.complete, false);
  assert.match(result.complete ? '' : result.reason, /reconciliation safety limit/i);
  assert.equal(reader.calls.at(-1)?.take, 1);
});

test('rental settlement history rejects deterministic idempotency evidence that does not match the retained operation', async () => {
  const source = makeRows(1);
  source[0] = { ...source[0]!, idempotencyKey: `rental:manual-payment:${'a'.repeat(48)}` };
  const reader = createReader(source);
  const result = await readRentalPaymentSettlementHistory({ transaction: reader.transaction as never, organizationId, bookingId });

  assert.equal(result.complete, false);
  assert.match(result.complete ? '' : result.reason, /idempotency authority/i);
});

test('rental settlement history rejects a retained request fingerprint that does not match exact settlement evidence', async () => {
  const source = makeRows(1);
  source[0] = { ...source[0]!, requestFingerprint: 'f'.repeat(64) };
  const reader = createReader(source);
  const result = await readRentalPaymentSettlementHistory({ transaction: reader.transaction as never, organizationId, bookingId });

  assert.equal(result.complete, false);
  assert.match(result.complete ? '' : result.reason, /request fingerprint/i);
});

test('legacy null request fingerprints remain readable when deterministic operation evidence is intact', async () => {
  const source = makeRows(1);
  source[0] = { ...source[0]!, requestFingerprint: null };
  const reader = createReader(source);
  const result = await readRentalPaymentSettlementHistory({ transaction: reader.transaction as never, organizationId, bookingId });

  assert.equal(result.complete, true);
  assert.equal(result.complete ? result.transactions.length : -1, 1);
});

test('rental settlement history rejects invalid database-authored creation timestamps', async () => {
  const source = makeRows(1);
  source[0] = { ...source[0]!, createdAt: new Date(Number.NaN) };
  const reader = createReader(source);
  const result = await readRentalPaymentSettlementHistory({ transaction: reader.transaction as never, organizationId, bookingId });

  assert.equal(result.complete, false);
  assert.match(result.complete ? '' : result.reason, /creation timestamp/i);
});

test('rental settlement history rejects a successful refund that predates its retained source payment', async () => {
  const source = makeRows(2);
  source[0] = { ...source[0]!, createdAt: new Date('2026-09-16T02:00:00.000Z') };
  source[1] = { ...source[1]!, createdAt: new Date('2026-09-16T01:00:00.000Z') };
  const reader = createReader(source);
  const result = await readRentalPaymentSettlementHistory({ transaction: reader.transaction as never, organizationId, bookingId });

  assert.equal(result.complete, false);
  assert.match(result.complete ? '' : result.reason, /predates its retained source payment/i);
});
