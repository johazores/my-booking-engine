import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('prisma/migrations/20261028092000-stripe-payment-intent-booking-ownership/migration.sql');
const paymentSchema = read('prisma/payment-transactions.prisma');
const integration = read('src/server/payments/stripe-payment.integration.ts');
const constraint = 'payment_transactions_stripe_pi_booking_excl';

test('migration refuses cross-booking historical PaymentIntent evidence without rewriting it', () => {
  assert.match(migration, /DO \$\$[\s\S]*?FROM "payment_transactions"[\s\S]*?GROUP BY "organizationId", "providerReference"[\s\S]*?HAVING count\(DISTINCT "bookingId"\) > 1[\s\S]*?RAISE EXCEPTION[\s\S]*?END\s*\$\$;/);
  assert.match(migration, /USING ERRCODE = '23P01'/);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|INSERT|TRUNCATE)\s+"payment_transactions"/i);
});

test('GiST exclusion enforces one booking per tenant and pi_ reference, not one transaction', () => {
  assert.ok(Buffer.byteLength(constraint, 'utf8') <= 63);
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS btree_gist;/);
  assert.match(migration, /ADD CONSTRAINT "payment_transactions_stripe_pi_booking_excl"\s+EXCLUDE USING gist\s*\(\s*"organizationId" WITH =,\s*"providerReference" WITH =,\s*"bookingId" WITH <>\s*\)\s*WHERE \("providerCode" = 'stripe' AND left\("providerReference", 3\) = 'pi_'\);/);
  assert.equal((migration.match(/left\("providerReference", 3\) = 'pi_'/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /\bLIKE\s+'pi_%'/i);
  assert.doesNotMatch(paymentSchema, /@@unique\(\[organizationId, providerCode, providerReference\]/);
  assert.match(paymentSchema, /@@index\(\[organizationId, providerCode, providerReference\]/);
});

test('guarded PostgreSQL suite covers shared capture, conflicting writes, claim updates, and races', () => {
  assert.match(integration, /same-booking-source/);
  assert.match(integration, /for \(const kind of \['AUTHORIZATION', 'CAPTURE'\] as const\)/);
  assert.match(integration, /data: \{ providerReference: 'pi_sf_cross_booking_capture_10' \}/);
  assert.match(integration, /Promise\.allSettled\(/);
  assert.match(integration, /concurrentWrites\.filter\(\(result\) => result\.status === 'fulfilled'\)\.length, 1/);
  assert.match(integration, /providerReference: 'pi_sf_concurrent_booking_owner_12'/);
});
