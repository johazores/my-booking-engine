import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../prisma/migrations/20260924213000-hospitality-legal-document-time-integrity/migration.sql', import.meta.url),
  'utf8',
);

const postgresIdentifierPattern = /(?:CONSTRAINT|FUNCTION)\s+"?([a-zA-Z0-9_]+)"?/g;

test('legal document snapshot time is bound to the retained row timestamp', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION sf_hospitality_legal_snapshot_time_valid/);
  assert.match(migration, /snapshot->>'issuedAt'/);
  assert.match(migration, /issued_at_text::TIMESTAMPTZ/);
  assert.match(migration, /issued_at_value IS NOT DISTINCT FROM row_issued_at/);
  assert.match(migration, /hospitality_issued_invoices_snapshot_time_check/);
  assert.match(migration, /hospitality_adj_notes_snapshot_chronology_check/);
});

test('adjustment-note chronology is fail-closed for every supported immutable schema', () => {
  assert.match(migration, /schema_version IS NULL OR schema_version NOT IN \('1', '2', '3', '4', '5', '6'\)/);
  assert.match(migration, /source_issued_at_value > row_issued_at/);
  assert.match(migration, /schema_version IN \('2', '3', '4', '5'\)/);
  assert.match(migration, /amendment_applied_at_value < source_issued_at_value/);
  assert.match(migration, /amendment_applied_at_value > row_issued_at/);
  assert.match(migration, /schema_version IN \('3', '5', '6'\)/);
  assert.match(migration, /predecessor_issued_at_value < source_issued_at_value/);
  assert.match(migration, /predecessor_issued_at_value > row_issued_at/);
  assert.match(migration, /amendment_applied_at_value < predecessor_issued_at_value/);
});

test('migration validates retained legal evidence instead of grandfathering it', () => {
  assert.match(migration, /ADD CONSTRAINT "hospitality_issued_invoices_snapshot_time_check"[\s\S]*NOT VALID/);
  assert.match(migration, /ADD CONSTRAINT "hospitality_adj_notes_snapshot_chronology_check"[\s\S]*NOT VALID/);
  assert.match(migration, /VALIDATE CONSTRAINT "hospitality_issued_invoices_snapshot_time_check"/);
  assert.match(migration, /VALIDATE CONSTRAINT "hospitality_adj_notes_snapshot_chronology_check"/);
});

test('new PostgreSQL physical identifiers remain within the 63-byte limit', () => {
  const identifiers = [...migration.matchAll(postgresIdentifierPattern)].map((match) => match[1]);
  assert.ok(identifiers.length >= 4);
  for (const identifier of identifiers) {
    assert.ok(Buffer.byteLength(identifier, 'utf8') <= 63, `${identifier} exceeds PostgreSQL identifier storage`);
  }
});

test('time integrity does not pretend to freeze mutable provider settlement state', () => {
  assert.doesNotMatch(migration, /providerReference|sourceProviderReference|PaymentTransaction|payment_transactions|payment status/i);
  assert.doesNotMatch(migration, /\.github\/workflows|github actions/i);
});
