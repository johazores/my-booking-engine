import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Hospitality v6 refund-authority database integrity tests must run through npm run test:database with TEST_DATABASE_URL.');
}

const predecessorIssuedAt = '2026-09-20T09:00:00.000Z';
const issuedAt = '2026-09-20T11:00:00.000Z';
const firstRefundId = '11111111-1111-4111-8111-111111111111';
const secondRefundId = '22222222-2222-4222-8222-222222222222';

function snapshot() {
  return {
    schemaVersion: 6,
    predecessorAdjustmentIssuedAt: predecessorIssuedAt,
    issuedAt,
    refundAuthorities: [
      {
        refundTransactionId: firstRefundId,
        refundOrdinal: '1',
        amountMinor: '4000',
        createdAt: '2026-09-20T10:00:00.000Z',
      },
      {
        refundTransactionId: secondRefundId,
        refundOrdinal: '2',
        amountMinor: '6000',
        createdAt: '2026-09-20T10:30:00.000Z',
      },
    ],
  };
}

async function databaseValid(input: unknown, expectedTotalMinor = 10_000n, rowIssuedAt = new Date(issuedAt)) {
  const { db } = await import('../database.ts');
  const rows = await db.$queryRaw<Array<{ valid: boolean }>>`
    SELECT sf_hospitality_v6_refund_authorities_valid(
      ${JSON.stringify(input)}::jsonb,
      ${expectedTotalMinor}::bigint,
      ${rowIssuedAt}::timestamptz
    ) AS valid
  `;
  return rows[0]?.valid === true;
}

test('schema-version-6 refund-authority database guard accepts only exact frozen membership', async () => {
  assert.equal(await databaseValid(snapshot()), true);

  const duplicate = snapshot();
  duplicate.refundAuthorities[1]!.refundTransactionId = firstRefundId;
  assert.equal(await databaseValid(duplicate), false);

  const reordered = snapshot();
  reordered.refundAuthorities[1]!.refundOrdinal = '3';
  assert.equal(await databaseValid(reordered), false);

  const unexpectedMutableProviderTruth = snapshot();
  Object.assign(unexpectedMutableProviderTruth.refundAuthorities[0]!, { status: 'SUCCEEDED' });
  assert.equal(await databaseValid(unexpectedMutableProviderTruth), false);

  const missingAmount = snapshot();
  delete (missingAmount.refundAuthorities[0] as Partial<typeof missingAmount.refundAuthorities[number]>).amountMinor;
  assert.equal(await databaseValid(missingAmount), false);

  const malformedTimestamp = snapshot();
  malformedTimestamp.refundAuthorities[0]!.createdAt = 'not-a-timestamp';
  assert.equal(await databaseValid(malformedTimestamp), false);

  const badChronology = snapshot();
  badChronology.refundAuthorities[0]!.createdAt = predecessorIssuedAt;
  assert.equal(await databaseValid(badChronology), false);

  assert.equal(await databaseValid(snapshot(), 9_999n), false);
  assert.equal(await databaseValid(snapshot(), 10_000n, new Date('2026-09-20T11:00:01.000Z')), false);
});

test('schema-version-6 refund-authority constraint is installed and validated', async () => {
  const { db } = await import('../database.ts');
  const rows = await db.$queryRaw<Array<{ convalidated: boolean; definition: string }>>`
    SELECT constraint_row.convalidated,
           pg_get_constraintdef(constraint_row.oid) AS definition
      FROM pg_constraint constraint_row
      JOIN pg_class relation_row ON relation_row.oid = constraint_row.conrelid
     WHERE constraint_row.conname = 'hospitality_adj_notes_v6_refund_authorities_check'
       AND relation_row.relname = 'hospitality_issued_adjustment_notes'
  `;

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.convalidated, true);
  assert.match(rows[0]?.definition ?? '', /sf_hospitality_v6_refund_authorities_valid/i);
});

test('database helper is deliberately scoped away from older adjustment-note schemas', async () => {
  assert.equal(await databaseValid({ schemaVersion: 5 }), true);
});
