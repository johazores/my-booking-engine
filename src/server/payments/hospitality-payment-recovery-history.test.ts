import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSPITALITY_PAYMENT_RECOVERY_MAX_TRANSACTIONS,
  HOSPITALITY_PAYMENT_RECOVERY_PAGE_SIZE,
  readHospitalityPaymentRecoveryHistory,
} from './hospitality-payment-recovery-history.ts';

type Reader = Parameters<typeof readHospitalityPaymentRecoveryHistory>[0]['transaction'];

type Row = {
  id: string;
  organizationId: string;
  bookingId: string;
  commercialAmendmentId: string | null;
  idempotencyKey: string;
  requestFingerprint: string | null;
  kind: 'OFFLINE_PAYMENT';
  status: 'SUCCEEDED';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: null;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
};

function row(index: number, overrides: Partial<Row> = {}): Row {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    organizationId: '11111111-1111-4111-8111-111111111111',
    bookingId: '22222222-2222-4222-8222-222222222222',
    commercialAmendmentId: '33333333-3333-4333-8333-333333333333',
    idempotencyKey: `recovery-${index}`,
    requestFingerprint: `fingerprint-${index}`,
    kind: 'OFFLINE_PAYMENT',
    status: 'SUCCEEDED',
    providerCode: 'manual',
    providerReference: `payment-${index}`,
    sourceProviderReference: null,
    currency: 'AUD',
    amountMinor: 100n,
    createdAt: new Date(Date.parse('2026-09-23T00:00:00.000Z') + index * 1_000),
    ...overrides,
  };
}

function readerFor(rows: readonly Row[]) {
  const sorted = [...rows].sort((left, right) => left.id.localeCompare(right.id));
  const calls: unknown[] = [];
  const reader = {
    paymentTransaction: {
      findMany: async (args: {
        take: number;
        cursor?: { id: string };
        skip?: number;
        select: Record<string, boolean>;
      }) => {
        calls.push(args);
        const start = args.cursor
          ? Math.max(0, sorted.findIndex((candidate) => candidate.id === args.cursor!.id) + (args.skip ?? 0))
          : 0;
        return sorted.slice(start, start + args.take).map((candidate) => {
          if (Object.keys(args.select).length === 1 && args.select.id) return { id: candidate.id };
          return candidate;
        });
      },
    },
  } as unknown as Reader;
  return { reader, calls };
}

test('reads complete recovery history in bounded pages and preserves recovery identity evidence', async () => {
  const rows = Array.from({ length: HOSPITALITY_PAYMENT_RECOVERY_PAGE_SIZE + 1 }, (_, index) => row(index + 1));
  rows[0]!.createdAt = new Date('2026-09-23T02:00:00.000Z');
  rows[1]!.createdAt = new Date('2026-09-23T01:00:00.000Z');
  const { reader, calls } = readerFor(rows);

  const result = await readHospitalityPaymentRecoveryHistory({
    transaction: reader,
    organizationId: rows[0]!.organizationId,
    bookingId: rows[0]!.bookingId,
  });

  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.equal(result.transactions.length, rows.length);
  assert.equal(result.transactions.find((entry) => entry.id === rows[0]!.id)?.idempotencyKey, rows[0]!.idempotencyKey);
  assert.equal(result.transactions.find((entry) => entry.id === rows[0]!.id)?.requestFingerprint, rows[0]!.requestFingerprint);
  for (let index = 1; index < result.transactions.length; index += 1) {
    assert.ok(result.transactions[index - 1]!.createdAt.getTime() <= result.transactions[index]!.createdAt.getTime());
  }
  assert.equal(calls.length, 2);
});

test('fails closed when recovery evidence escapes tenant booking scope', async () => {
  const valid = row(1);
  const { reader } = readerFor([
    valid,
    row(2, { bookingId: '44444444-4444-4444-8444-444444444444' }),
  ]);

  const result = await readHospitalityPaymentRecoveryHistory({
    transaction: reader,
    organizationId: valid.organizationId,
    bookingId: valid.bookingId,
  });

  assert.deepEqual(result, {
    complete: false,
    reason: 'Hospitality recovery payment history returned evidence outside the requested tenant booking scope.',
  });
});

test('fails closed on invalid recovery chronology evidence', async () => {
  const valid = row(1);
  const { reader } = readerFor([row(1, { createdAt: new Date(Number.NaN) })]);

  const result = await readHospitalityPaymentRecoveryHistory({
    transaction: reader,
    organizationId: valid.organizationId,
    bookingId: valid.bookingId,
  });

  assert.equal(result.complete, false);
  if (result.complete) return;
  assert.match(result.reason, /invalid database creation timestamp/i);
});

test('accepts exactly the recovery safety limit when overflow is absent', async () => {
  const rows = Array.from({ length: HOSPITALITY_PAYMENT_RECOVERY_MAX_TRANSACTIONS }, (_, index) => row(index + 1));
  const { reader, calls } = readerFor(rows);

  const result = await readHospitalityPaymentRecoveryHistory({
    transaction: reader,
    organizationId: rows[0]!.organizationId,
    bookingId: rows[0]!.bookingId,
  });

  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.equal(result.transactions.length, HOSPITALITY_PAYMENT_RECOVERY_MAX_TRANSACTIONS);
  assert.equal(calls.length, HOSPITALITY_PAYMENT_RECOVERY_MAX_TRANSACTIONS / HOSPITALITY_PAYMENT_RECOVERY_PAGE_SIZE + 1);
});

test('fails closed above the recovery safety limit', async () => {
  const rows = Array.from({ length: HOSPITALITY_PAYMENT_RECOVERY_MAX_TRANSACTIONS + 1 }, (_, index) => row(index + 1));
  const { reader } = readerFor(rows);

  const result = await readHospitalityPaymentRecoveryHistory({
    transaction: reader,
    organizationId: rows[0]!.organizationId,
    bookingId: rows[0]!.bookingId,
  });

  assert.equal(result.complete, false);
  if (result.complete) return;
  assert.match(result.reason, /exceeds the 1000-transaction safety limit/i);
});
