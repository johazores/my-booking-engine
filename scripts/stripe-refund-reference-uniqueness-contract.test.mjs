import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('prisma/migrations/20261028082500-stripe-refund-reference-uniqueness/migration.sql');
const paymentSchema = read('prisma/payment-transactions.prisma');
const indexName = 'payment_transactions_stripe_refund_ref_key';

test('existing Stripe refund references must be reconciled before uniqueness enforcement', () => {
  assert.match(migration, /DO \$\$[\s\S]*?IF EXISTS \([\s\S]*?FROM "payment_transactions"[\s\S]*?GROUP BY "organizationId", "providerReference"[\s\S]*?HAVING count\(\*\) > 1[\s\S]*?RAISE EXCEPTION[\s\S]*?END\s*\$\$;/);
  assert.match(migration, /USING ERRCODE = '23505'/);
  assert.equal((migration.match(/"providerCode" = 'stripe'/g) ?? []).length, 2);
  assert.equal((migration.match(/left\("providerReference", 3\) = 're_'/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|INSERT|TRUNCATE)\s+"payment_transactions"/i);
});

test('database uniqueness covers all Stripe re_ references per tenant, not shared pi_ captures', () => {
  assert.ok(Buffer.byteLength(indexName, 'utf8') <= 63);
  assert.match(migration, /CREATE UNIQUE INDEX "payment_transactions_stripe_refund_ref_key"\s+ON "payment_transactions"\("organizationId", "providerReference"\)\s+WHERE "providerCode" = 'stripe'\s+AND left\("providerReference", 3\) = 're_';/);
  assert.doesNotMatch(migration, /\bLIKE\s+'re_%'/i);
  assert.doesNotMatch(migration, /\b(?:DROP INDEX|DROP CONSTRAINT|ALTER TABLE)\b/i);
  assert.match(paymentSchema, /@@index\(\[organizationId, providerCode, providerReference\], map: "payment_transactions_org_provider_reference_idx"\)/);
  assert.doesNotMatch(paymentSchema, /@@unique\(\[organizationId, providerCode, providerReference\]/);
});
