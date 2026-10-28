import assert from 'node:assert/strict';
import test from 'node:test';

// Prisma cannot model these partial/exclusion indexes. Check deployed catalog
// authority independently of Prisma schema drift and direct-write regressions.
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!testDatabaseUrl || process.env.DATABASE_URL?.trim() !== testDatabaseUrl) {
  throw new Error('Stripe reference database authority tests require the guarded npm run test:database target.');
}

type ReferenceIndex = {
  indexName: string;
  accessMethod: string;
  isValid: boolean;
  isReady: boolean;
  isLive: boolean;
  isUnique: boolean;
  isExclusion: boolean;
  keyCount: number;
  predicate: string | null;
  constraintType: string | null;
  constraintValidated: boolean | null;
  constraintDefinition: string | null;
  keyOne: string | null;
  keyTwo: string | null;
  keyThree: string | null;
  keyFour: string | null;
};

const refundIndex = 'payment_transactions_stripe_refund_ref_key';
const bookingConstraint = 'payment_transactions_stripe_pi_booking_excl';
const amendmentConstraint = 'payment_transactions_stripe_pi_amendment_excl';

function normalizeKey(value: string | null) {
  return (value ?? '').replaceAll('"', '').replace(/\s+/g, '');
}

function assertStripePredicate(predicate: string | null, prefix: 're_' | 'pi_') {
  assert.ok(predicate, 'The partial index predicate must be present.');
  assert.match(predicate, /providerCode/);
  assert.match(predicate, /stripe/);
  assert.match(predicate, /providerReference/);
  assert.match(predicate, /left/i);
  assert.ok(predicate.includes(prefix), 'The predicate must scope the exact Stripe reference prefix.');
}

test('deployed PostgreSQL retains the Stripe reference uniqueness and ownership constraints', async () => {
  const { db } = await import('../database.ts');

  const extension = await db.$queryRaw<Array<{ installed: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS installed
  `;
  assert.equal(extension[0]?.installed, true, 'The GiST equality/inequality operator classes must be installed.');

  const rows = await db.$queryRaw<ReferenceIndex[]>`
    SELECT index_class.relname AS "indexName",
           access_method.amname AS "accessMethod",
           index_row.indisvalid AS "isValid",
           index_row.indisready AS "isReady",
           index_row.indislive AS "isLive",
           index_row.indisunique AS "isUnique",
           index_row.indisexclusion AS "isExclusion",
           index_row.indnkeyatts::integer AS "keyCount",
           pg_get_expr(index_row.indpred, index_row.indrelid) AS predicate,
           constraint_row.contype::text AS "constraintType",
           constraint_row.convalidated AS "constraintValidated",
           pg_get_constraintdef(constraint_row.oid) AS "constraintDefinition",
           pg_get_indexdef(index_row.indexrelid, 1, true) AS "keyOne",
           pg_get_indexdef(index_row.indexrelid, 2, true) AS "keyTwo",
           pg_get_indexdef(index_row.indexrelid, 3, true) AS "keyThree",
           pg_get_indexdef(index_row.indexrelid, 4, true) AS "keyFour"
      FROM pg_index index_row
      JOIN pg_class table_class ON table_class.oid = index_row.indrelid
      JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
      JOIN pg_am access_method ON access_method.oid = index_class.relam
      LEFT JOIN pg_constraint constraint_row
        ON constraint_row.conindid = index_row.indexrelid
       AND constraint_row.conrelid = table_class.oid
     WHERE table_class.oid = to_regclass('payment_transactions')
       AND index_class.relname IN (
         'payment_transactions_stripe_refund_ref_key',
         'payment_transactions_stripe_pi_booking_excl',
         'payment_transactions_stripe_pi_amendment_excl'
       )
  `;

  assert.equal(rows.length, 3, 'All three raw PostgreSQL payment-reference indexes must exist.');
  const byName = new Map(rows.map((row) => [row.indexName, row]));
  for (const row of rows) {
    assert.equal(row.isValid, true, `${row.indexName} must be valid.`);
    assert.equal(row.isReady, true, `${row.indexName} must accept new writes.`);
    assert.equal(row.isLive, true, `${row.indexName} must not be pending removal.`);
    assert.equal(normalizeKey(row.keyOne), 'organizationId');
  }

  const refund = byName.get(refundIndex)!;
  assert.equal(refund.accessMethod, 'btree');
  assert.equal(refund.isUnique, true);
  assert.equal(refund.isExclusion, false);
  assert.equal(refund.constraintType, null);
  assert.equal(refund.keyCount, 2);
  assert.equal(normalizeKey(refund.keyTwo), 'providerReference');
  assertStripePredicate(refund.predicate, 're_');

  const booking = byName.get(bookingConstraint)!;
  assert.equal(booking.accessMethod, 'gist');
  assert.equal(booking.isUnique, false);
  assert.equal(booking.isExclusion, true);
  assert.equal(booking.constraintType, 'x');
  assert.equal(booking.constraintValidated, true);
  assert.equal(booking.keyCount, 3);
  assert.equal(normalizeKey(booking.keyTwo), 'providerReference');
  assert.equal(normalizeKey(booking.keyThree), 'bookingId');
  assert.match(booking.constraintDefinition ?? '', /"organizationId"\s+WITH\s+=/);
  assert.match(booking.constraintDefinition ?? '', /"providerReference"\s+WITH\s+=/);
  assert.match(booking.constraintDefinition ?? '', /bookingId"?\s+WITH\s+<>/);
  assertStripePredicate(booking.predicate, 'pi_');

  const amendment = byName.get(amendmentConstraint)!;
  assert.equal(amendment.accessMethod, 'gist');
  assert.equal(amendment.isUnique, false);
  assert.equal(amendment.isExclusion, true);
  assert.equal(amendment.constraintType, 'x');
  assert.equal(amendment.constraintValidated, true);
  assert.equal(amendment.keyCount, 4);
  assert.equal(normalizeKey(amendment.keyTwo), 'bookingId');
  assert.equal(normalizeKey(amendment.keyThree), 'providerReference');
  assert.match(normalizeKey(amendment.keyFour), /coalesce\(/i);
  assert.match(normalizeKey(amendment.keyFour), /commercialAmendmentId/);
  assert.match(normalizeKey(amendment.keyFour), /base-booking/);
  assert.match(amendment.constraintDefinition ?? '', /"organizationId"\s+WITH\s+=/);
  assert.match(amendment.constraintDefinition ?? '', /"bookingId"\s+WITH\s+=/);
  assert.match(amendment.constraintDefinition ?? '', /"providerReference"\s+WITH\s+=/);
  assert.match(amendment.constraintDefinition ?? '', /coalesce[\s\S]*WITH\s+<>/i);
  assertStripePredicate(amendment.predicate, 'pi_');
});
