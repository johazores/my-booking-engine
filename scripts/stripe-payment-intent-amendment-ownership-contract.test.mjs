import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const migration = read('prisma/migrations/20261028102000-stripe-payment-intent-amendment-ownership/migration.sql');
const bookingMigration = read('prisma/migrations/20261028092000-stripe-payment-intent-booking-ownership/migration.sql');
const paymentSchema = read('prisma/payment-transactions.prisma');
const integration = read('src/server/payments/stripe-payment.integration.ts');
const constraint = 'payment_transactions_stripe_pi_amendment_excl';

test('Stripe PaymentIntent amendment preflight refuses historical mixed-scope ownership', () => {
  assert.match(migration, /GROUP BY "organizationId", "bookingId", "providerReference"/);
  assert.match(migration, /count\(DISTINCT coalesce\("commercialAmendmentId"::text, 'base-booking'\)\) > 1/);
  assert.match(migration, /RAISE EXCEPTION[\s\S]*?USING ERRCODE = '23P01'/);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|INSERT|TRUNCATE)\s+"payment_transactions"/i);
});

test('GiST exclusion distinguishes base and amendment scopes without forbidding same-scope capture', () => {
  assert.ok(Buffer.byteLength(constraint, 'utf8') <= 63);
  assert.match(bookingMigration, /CREATE EXTENSION IF NOT EXISTS btree_gist;/);
  assert.match(bookingMigration, /"bookingId" WITH <>/);
  assert.match(migration, /ADD CONSTRAINT "payment_transactions_stripe_pi_amendment_excl"\s+EXCLUDE USING gist\s*\(\s*"organizationId" WITH =,\s*"bookingId" WITH =,\s*"providerReference" WITH =,\s*\(coalesce\("commercialAmendmentId"::text, 'base-booking'\)\) WITH <>\s*\)\s*WHERE \("providerCode" = 'stripe' AND left\("providerReference", 3\) = 'pi_'\);/);
  assert.equal((migration.match(/left\("providerReference", 3\) = 'pi_'/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /\bLIKE\s+'pi_%'/i);
  assert.doesNotMatch(paymentSchema, /@@unique\(\[organizationId, providerCode, providerReference\]/);
  assert.match(paymentSchema, /@@index\(\[organizationId, providerCode, providerReference\]/);
});

test('guarded PostgreSQL scenarios cover mixed scopes, claim updates, and concurrent writers', () => {
  for (const token of [
    'pi_sf_same_amendment_capture_10',
    'pi_sf_concurrent_amendment_owner_10',
    'commercialAmendmentId: amendmentOne.id',
    'commercialAmendmentId: amendmentTwo.id',
    'data: { commercialAmendmentId: amendmentTwo.id }',
    'data: { commercialAmendmentId: null }',
    "data: { providerCode: 'stripe' }",
    'stripe:scope:amendment-base-conflict',
    'data: { providerReference: amendmentSourceReference }',
    "amendmentConcurrentWrites.filter((result) => result.status === 'fulfilled').length, 1",
  ]) assert.ok(integration.includes(token), 'Missing PostgreSQL regression: ' + token);
});
