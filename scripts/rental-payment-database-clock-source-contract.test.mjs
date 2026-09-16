import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authorityMigration = readFileSync(
  'prisma/migrations/20260916153500_rental_payment_request_evidence/migration.sql',
  'utf8',
);
const clockMigration = readFileSync(
  'prisma/migrations/20260916172000_rental_payment_database_clock/migration.sql',
  'utf8',
);
const docs = readFileSync('docs/rental-payment-request-evidence.md', 'utf8');

test('follow-up migration authors rental settlement chronology from PostgreSQL wall clock', () => {
  assert.match(clockMigration, /CREATE OR REPLACE FUNCTION sf_guard_rental_payment_request_evidence/);
  assert.match(clockMigration, /NEW\."createdAt" := clock_timestamp\(\)/);
  assert.doesNotMatch(clockMigration, /NEW\."createdAt" IS DISTINCT FROM CURRENT_TIMESTAMP/);
});

test('follow-up migration preserves request evidence and operation namespace guards', () => {
  for (const pattern of [
    /NEW\."requestFingerprint" IS NULL/,
    /\^\[a-f0-9\]\{64\}\$/,
    /\^rental:manual-payment:\[a-f0-9\]\{48\}\$/,
    /\^rental:manual-refund:\[a-f0-9\]\{48\}\$/,
  ]) {
    assert.match(authorityMigration, pattern);
    assert.match(clockMigration, pattern);
  }
});

test('documentation distinguishes transaction-start time from insertion wall clock', () => {
  assert.match(docs, /`CURRENT_TIMESTAMP` is the transaction-start time/);
  assert.match(docs, /`clock_timestamp\(\)` records the database wall clock at that actual insert boundary/);
  assert.match(docs, /Caller-supplied `createdAt` values are overwritten/);
  assert.match(docs, /does not add Stripe rental checkout, deposits, split tenders/i);
  assert.match(docs, /GitHub Actions are not required or used/);
});
