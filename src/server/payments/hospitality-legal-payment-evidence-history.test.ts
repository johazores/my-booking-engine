import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOSPITALITY_LEGAL_PAYMENT_EVIDENCE_MAX_TRANSACTIONS,
  HOSPITALITY_LEGAL_PAYMENT_EVIDENCE_PAGE_SIZE,
  readHospitalityLegalPaymentEvidenceHistory,
} from './hospitality-legal-payment-evidence-history.ts';

type TestRow = Readonly<{
  id: string;
  organizationId: string;
  bookingId: string;
  commercialAmendmentId: string | null;
  kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
}>;

function row(index: number, createdAt = new Date(1_700_000_000_000 + index * 1_000)): TestRow {
  return Object.freeze({
    id: `tx-${index.toString().padStart(5, '0')}`,
    organizationId: 'org-a',
    bookingId: 'booking-a',
    commercialAmendmentId: index % 2 === 0 ? 'amendment-a' : null,
    kind: index % 3 === 0 ? 'REFUND' : 'CAPTURE',
    status: 'SUCCEEDED',
    providerCode: 'manual',
    providerReference: `provider-${index}`,
    sourceProviderReference: index % 3 === 0 ? `source-${index}` : null,
    currency: 'AUD',
    amountMinor: 100n,
    createdAt,
  });
}

function reader(rows: readonly TestRow[], calls: unknown[] = []) {
  return {
    paymentTransaction: {
      async findMany(args: any) {
        calls.push(args);
        let filtered = rows.filter((candidate) => (
          candidate.organizationId === args.where.organizationId
          && candidate.bookingId === args.where.bookingId
        ));
        const through = args.where.createdAt?.lte;
        if (through instanceof Date) {
          filtered = filtered.filter((candidate) => candidate.createdAt.getTime() <= through.getTime());
        }
        filtered = [...filtered].sort((left, right) => left.id.localeCompare(right.id));
        if (args.cursor?.id) {
          const cursorIndex = filtered.findIndex((candidate) => candidate.id === args.cursor.id);
          filtered = cursorIndex < 0 ? [] : filtered.slice(cursorIndex + (args.skip ?? 0));
        }
        return filtered.slice(0, args.take);
      },
    },
  };
}

test('reads every bounded page and returns deterministic issue evidence chronology', async () => {
  const rows = Array.from({ length: HOSPITALITY_LEGAL_PAYMENT_EVIDENCE_PAGE_SIZE + 5 }, (_, index) => row(index));
  const swapped = [rows[1]!, rows[0]!, ...rows.slice(2)];
  const calls: unknown[] = [];
  const result = await readHospitalityLegalPaymentEvidenceHistory({
    transaction: reader(swapped, calls) as never,
    organizationId: 'org-a',
    bookingId: 'booking-a',
  });

  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.equal(result.transactions.length, rows.length);
  assert.equal(result.transactions[0]!.id, 'tx-00000');
  assert.equal(result.transactions.at(-1)!.id, `tx-${(rows.length - 1).toString().padStart(5, '0')}`);
  assert.equal(calls.length, 2);
});

test('applies a frozen issue-time horizon to every legal evidence page', async () => {
  const rows = [row(0), row(1), row(2), row(3)];
  const through = rows[1]!.createdAt;
  const calls: any[] = [];
  const result = await readHospitalityLegalPaymentEvidenceHistory({
    transaction: reader(rows, calls) as never,
    organizationId: 'org-a',
    bookingId: 'booking-a',
    through,
  });

  assert.equal(result.complete, true);
  if (!result.complete) return;
  assert.deepEqual(result.transactions.map((transaction) => transaction.id), ['tx-00000', 'tx-00001']);
  assert.ok(calls.every((call) => call.where.createdAt?.lte === through));
});

test('fails closed if returned legal evidence escapes tenant scope or has invalid chronology', async () => {
  const wrongScope = { ...row(0), organizationId: 'org-b' };
  const invalidTime = { ...row(1), createdAt: new Date(Number.NaN) };

  const scopeResult = await readHospitalityLegalPaymentEvidenceHistory({
    transaction: {
      paymentTransaction: { async findMany() { return [wrongScope]; } },
    } as never,
    organizationId: 'org-a',
    bookingId: 'booking-a',
  });
  assert.equal(scopeResult.complete, false);

  const timeResult = await readHospitalityLegalPaymentEvidenceHistory({
    transaction: {
      paymentTransaction: { async findMany() { return [invalidTime]; } },
    } as never,
    organizationId: 'org-a',
    bookingId: 'booking-a',
  });
  assert.equal(timeResult.complete, false);
});

test('fails closed instead of returning a truncated legal ledger above the safety ceiling', async () => {
  const rows = Array.from(
    { length: HOSPITALITY_LEGAL_PAYMENT_EVIDENCE_MAX_TRANSACTIONS + 1 },
    (_, index) => row(index),
  );
  const result = await readHospitalityLegalPaymentEvidenceHistory({
    transaction: reader(rows) as never,
    organizationId: 'org-a',
    bookingId: 'booking-a',
  });

  assert.equal(result.complete, false);
  if (result.complete) return;
  assert.match(result.reason, /exceeds the 5000-transaction safety limit/);
});
