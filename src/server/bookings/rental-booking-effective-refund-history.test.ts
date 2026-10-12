import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentalBookingEffectiveRefundIdempotencyKey,
  buildRentalBookingEffectiveRefundRequestFingerprint,
} from './rental-booking-effective-refund-domain.ts';
import {
  readRentalBookingEffectiveRefundHistory,
  RENTAL_BOOKING_EFFECTIVE_REFUND_MAX_TRANSACTIONS,
  RENTAL_BOOKING_EFFECTIVE_REFUND_PAGE_SIZE,
} from './rental-booking-effective-refund-history.ts';

const organizationId = 'org-1';
const bookingId = 'booking-1';
const amendmentId = 'amendment-1';
const appliedAt = new Date('2026-09-20T00:00:00.000Z');

function makeRows(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const providerReference = `POST-REF-${index + 1}`;
    const idempotencyKey = buildRentalBookingEffectiveRefundIdempotencyKey({
      bookingId, amendmentId, reference: providerReference,
    });
    const sourceLedger = 'BOOKING_PRICE' as const;
    const providerCode = 'manual';
    const sourceProviderReference = 'ORIGINAL-PAY-1';
    const currency = 'AUD';
    const amountMinor = 1n;
    const requestFingerprint = buildRentalBookingEffectiveRefundRequestFingerprint({
      organizationId, bookingId, amendmentId, idempotencyKey, sourceLedger,
      providerCode, providerReference, sourceProviderReference, currency, amountMinor,
    });
    return {
      id: `${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
      organizationId, bookingId, amendmentId, idempotencyKey, requestFingerprint,
      sourceLedger, status: 'SUCCEEDED' as const, providerCode, providerReference,
      sourceProviderReference, currency, amountMinor,
      createdAt: new Date(appliedAt.getTime() + 1_000 + index),
    };
  });
}

type Row = Omit<ReturnType<typeof makeRows>[number], 'sourceLedger'> & {
  sourceLedger: 'BOOKING_PRICE' | 'COMMERCIAL_AMENDMENT';
};
type AmendmentEvidence = Readonly<{
  direction: 'ADDITIONAL_CHARGE' | 'REFUND';
  deltaMinor: bigint;
}>;

function withSource(row: Row, changes: Partial<Pick<Row, 'sourceLedger' | 'sourceProviderReference' | 'amountMinor' | 'createdAt'>>): Row {
  const updated = { ...row, ...changes };
  return {
    ...updated,
    requestFingerprint: buildRentalBookingEffectiveRefundRequestFingerprint(updated),
  };
}
type FindManyArgs = Readonly<{
  where: { organizationId: string; bookingId: string; amendmentId: string };
  take: number;
  cursor?: { id: string };
  skip?: number;
}>;

function createReader(
  rows: Row[],
  override?: (args: FindManyArgs, page: Row[]) => Row[],
  amendmentOverride?: AmendmentEvidence | null,
) {
  const calls: FindManyArgs[] = [];
  const amendmentCalls: unknown[] = [];
  return {
    calls,
    amendmentCalls,
    transaction: {
      rentalBookingCommercialAmendment: {
        async findFirst(args: Readonly<{
          where: { id: string; bookingId: string; organizationId: string; status: 'APPLIED' };
          select: { direction: true; deltaMinor: true };
        }>) {
          amendmentCalls.push(args);
          assert.deepEqual(args.where, { id: amendmentId, bookingId, organizationId, status: 'APPLIED' });
          assert.deepEqual(args.select, { direction: true, deltaMinor: true });
          return amendmentOverride === undefined
            ? { direction: 'REFUND' as const, deltaMinor: 200n }
            : amendmentOverride;
        },
      },
      rentalBookingEffectiveRefundTransaction: {
        async findMany(args: FindManyArgs) {
          calls.push(args);
          assert.deepEqual(args.where, { organizationId, bookingId, amendmentId });
          assert.ok(args.take <= RENTAL_BOOKING_EFFECTIVE_REFUND_PAGE_SIZE);
          let start = 0;
          if (args.cursor?.id) {
            const cursorIndex = rows.findIndex((row) => row.id === args.cursor?.id);
            start = cursorIndex + Number(args.skip ?? 0);
          }
          const page = rows.slice(start, start + args.take);
          return override ? override(args, page) : page;
        },
      },
    },
  };
}

async function read(reader: ReturnType<typeof createReader>, timestamp = appliedAt) {
  return readRentalBookingEffectiveRefundHistory({
    transaction: reader.transaction as never,
    organizationId, bookingId, amendmentId, appliedAt: timestamp,
  });
}

test('post-apply refund history reads all tenant-scoped pages and accepts the exact safety limit', async () => {
  const reader = createReader(makeRows(205));
  const result = await read(reader);
  assert.equal(result.complete, true);
  assert.equal(result.complete ? result.transactions.length : -1, 205);
  assert.equal(reader.calls.length, 3);
  const exact = await read(createReader(makeRows(RENTAL_BOOKING_EFFECTIVE_REFUND_MAX_TRANSACTIONS)));
  assert.equal(exact.complete, true);
  assert.equal(exact.complete ? exact.transactions.length : -1, RENTAL_BOOKING_EFFECTIVE_REFUND_MAX_TRANSACTIONS);
});

test('post-apply refund history rejects a page beyond the 1,000-row safety limit', async () => {
  const reader = createReader(makeRows(RENTAL_BOOKING_EFFECTIVE_REFUND_MAX_TRANSACTIONS + 1));
  const result = await read(reader);
  assert.equal(result.complete, false);
  assert.match(result.complete ? '' : result.reason, /reconciliation safety limit/i);
  assert.equal(reader.calls.at(-1)?.take, 1);
});

test('post-apply refund history rejects oversized pages before retaining evidence', async () => {
  const rows = makeRows(101);
  const reader = createReader(rows, () => rows);
  const result = await read(reader);
  assert.equal(result.complete, false);
  assert.match(result.complete ? '' : result.reason, /oversized transaction page/i);
});

test('post-apply refund history rejects missing, repeated, or descending IDs', async () => {
  for (const rows of [
    [{ ...makeRows(1)[0]!, id: '' }],
    (() => { const rows = makeRows(2); rows[1] = { ...rows[1]!, id: rows[0]!.id }; return rows; })(),
    makeRows(2).reverse(),
  ]) {
    const result = await read(createReader(rows));
    assert.equal(result.complete, false);
    assert.match(result.complete ? '' : result.reason, /out-of-order transaction IDs/i);
  }
});

test('post-apply refund history rejects repeated IDs across cursor pages', async () => {
  const rows = makeRows(101);
  rows[100] = { ...rows[100]!, id: rows[99]!.id };
  const result = await read(createReader(rows));
  assert.equal(result.complete, false);
  assert.match(result.complete ? '' : result.reason, /out-of-order transaction IDs/i);
});

test('post-apply refund history rejects invalid amendment time without querying payment evidence', async () => {
  const reader = createReader(makeRows(1));
  const result = await read(reader, new Date(Number.NaN));
  assert.equal(result.complete, false);
  assert.match(result.complete ? '' : result.reason, /invalid terminal timestamp/i);
  assert.equal(reader.calls.length, 0);
});

test('post-apply refund history rejects cross-tenant, pre-apply, and malformed monetary evidence', async () => {
  const original = makeRows(1)[0]!;
  const cases = [
    { ...original, organizationId: 'other-tenant' },
    { ...original, createdAt: new Date(appliedAt.getTime() - 1) },
    { ...original, amountMinor: '1' as unknown as bigint },
    { ...original, amountMinor: -1n },
    { ...original, providerReference: null as unknown as string },
    { ...original, sourceProviderReference: null as unknown as string },
  ];
  for (const row of cases) {
    const result = await read(createReader([row]));
    assert.equal(result.complete, false);
    assert.match(result.complete ? '' : result.reason, /invalid tenant, lifecycle, provider, monetary, or chronology evidence/i);
  }
});

test('post-apply refund history rejects tampered idempotency and fingerprint evidence', async () => {
  const original = makeRows(1)[0]!;
  for (const row of [
    { ...original, idempotencyKey: 'invalid' },
    { ...original, requestFingerprint: 'f'.repeat(64) },
  ]) {
    const result = await read(createReader([row]));
    assert.equal(result.complete, false);
    assert.match(result.complete ? '' : result.reason, /idempotency authority|request fingerprint/i);
  }
});

test('post-apply refund history requires tenant-owned applied amendment before reading rows', async () => {
  const reader = createReader(makeRows(1), undefined, null);
  const result = await read(reader);
  assert.equal(result.complete, false);
  assert.match(result.complete ? '' : result.reason, /no tenant-owned applied amendment/i);
  assert.equal(reader.calls.length, 0);
  assert.equal(reader.amendmentCalls.length, 1);
});

test('post-apply refund history rechecks chronology rather than UUID order or final totals', async () => {
  const rows = makeRows(2);
  const first = withSource(rows[0]!, { createdAt: new Date(appliedAt.getTime() + 1_000) });
  const second = withSource(rows[1]!, {
    sourceLedger: 'COMMERCIAL_AMENDMENT',
    sourceProviderReference: 'AMENDMENT-PAY-1',
    amountMinor: 200n,
    createdAt: new Date(appliedAt.getTime() + 2_000),
  });
  const reader = createReader([first, second], undefined, { direction: 'ADDITIONAL_CHARGE', deltaMinor: 200n });
  const result = await read(reader);
  assert.equal(result.complete, false);
  assert.match(result.complete ? '' : result.reason, /predate full refund/i);
});

test('post-apply refund chronology is reconciled across page boundaries', async () => {
  const rows = makeRows(101).map((item, index) => withSource(item, {
    sourceLedger: index < 100 ? 'COMMERCIAL_AMENDMENT' : 'BOOKING_PRICE',
    sourceProviderReference: index < 100 ? 'AMENDMENT-PAY-1' : 'ORIGINAL-PAY-1',
    amountMinor: index < 100 ? 2n : 1n,
  }));
  const good = createReader(rows, undefined, { direction: 'ADDITIONAL_CHARGE', deltaMinor: 200n });
  const accepted = await read(good);
  assert.equal(accepted.complete, true);
  assert.equal(good.calls.length, 2);

  const badRows = rows.map((item, index) => index === 99
    ? withSource(item, { sourceLedger: 'BOOKING_PRICE', sourceProviderReference: 'ORIGINAL-PAY-1' })
    : index === 100
      ? withSource(item, { sourceLedger: 'COMMERCIAL_AMENDMENT', sourceProviderReference: 'AMENDMENT-PAY-1' })
      : item);
  const rejected = await read(createReader(badRows, undefined, { direction: 'ADDITIONAL_CHARGE', deltaMinor: 200n }));
  assert.equal(rejected.complete, false);
  assert.match(rejected.complete ? '' : rejected.reason, /predate full refund/i);
});

test('post-apply refund history rejects malformed amendment authority', async () => {
  const rows = makeRows(1);
  for (const invalid of [
    { direction: 'INVALID', deltaMinor: 200n },
    { direction: 'ADDITIONAL_CHARGE', deltaMinor: '200' },
  ]) {
    const reader = createReader(rows, undefined, invalid as never);
    const result = await read(reader);
    assert.equal(result.complete, false);
    assert.match(result.complete ? '' : result.reason, /invalid amendment authority/i);
  }
});
