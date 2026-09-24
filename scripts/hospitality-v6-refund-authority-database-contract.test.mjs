import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const migrationPath = 'prisma/migrations/20260924202500-hospitality-v6-refund-authority-db-integrity/migration.sql';
const docsPath = 'docs/cancellation-refund-authority-database-integrity.md';
const integrationPath = 'src/server/payments/hospitality-v6-refund-authority-database-integrity.integration.ts';
const databaseRunnerPath = 'scripts/run-database-tests.mjs';
const authorityDocsPath = 'docs/adjustment-note-authority.md';

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('schema-version-6 frozen refund membership has a database direct-write backstop', async () => {
  const migration = await source(migrationPath);

  assert.match(migration, /CREATE OR REPLACE FUNCTION sf_hospitality_v6_refund_authorities_valid\(/);
  assert.match(migration, /LANGUAGE plpgsql[\s\S]*IMMUTABLE[\s\S]*PARALLEL SAFE/);
  assert.match(migration, /snapshot->>'schemaVersion' IS DISTINCT FROM '6'[\s\S]*RETURN TRUE/);
  assert.match(migration, /jsonb_typeof\(authorities\) IS DISTINCT FROM 'array'/);
  assert.match(migration, /jsonb_array_length\(authorities\) NOT BETWEEN 1 AND 256/);
  assert.match(migration, /key_count <> 4/);
  assert.match(migration, /authority \? 'refundTransactionId'/);
  assert.match(migration, /authority \? 'refundOrdinal'/);
  assert.match(migration, /authority \? 'amountMinor'/);
  assert.match(migration, /authority \? 'createdAt'/);
});

test('database validator preserves identity, ordering, chronology, uniqueness, and exact money', async () => {
  const migration = await source(migrationPath);

  assert.match(migration, /refund_id !~ '\^\[0-9a-f\]/);
  assert.match(migration, /refund_id = ANY\(seen_refund_ids\)/);
  assert.match(migration, /refund_ordinal_text::NUMERIC <> authority_index::NUMERIC/);
  assert.match(migration, /amount_text !~ '\^\[1-9\]\[0-9\]\*\$'/);
  assert.match(migration, /created_at_value <= predecessor_issued_at_value/);
  assert.match(migration, /created_at_value > row_issued_at/);
  assert.match(migration, /total_minor = expected_total_minor::NUMERIC/);
});

test('constraint is installed conservatively and validated against retained legal rows', async () => {
  const migration = await source(migrationPath);
  const constraintName = 'hospitality_adj_notes_v6_refund_authorities_check';
  const functionName = 'sf_hospitality_v6_refund_authorities_valid';

  assert.ok(constraintName.length <= 63, 'PostgreSQL constraint identifiers must remain within 63 bytes.');
  assert.ok(functionName.length <= 63, 'PostgreSQL function identifiers must remain within 63 bytes.');
  assert.match(migration, new RegExp(`ADD CONSTRAINT "${constraintName}"[\\s\\S]*NOT VALID`));
  assert.match(migration, new RegExp(`VALIDATE CONSTRAINT "${constraintName}"`));
  assert.match(migration, /sf_hospitality_v6_refund_authorities_valid\([\s\S]*"documentSnapshot"[\s\S]*"decreaseTotalMinor"[\s\S]*"issuedAt"/);
});

test('guarded disposable PostgreSQL suite exercises malformed direct evidence and the installed constraint', async () => {
  const integration = await source(integrationPath);
  const runner = await source(databaseRunnerPath);

  assert.match(integration, /TEST_DATABASE_URL/);
  assert.match(integration, /unexpectedMutableProviderTruth/);
  assert.match(integration, /duplicate/);
  assert.match(integration, /badChronology/);
  assert.match(integration, /hospitality_adj_notes_v6_refund_authorities_check/);
  assert.match(integration, /convalidated/);
  assert.match(runner, /hospitality-v6-refund-authority-database-integrity\.integration\.ts/);
});

test('documentation separates terminal refund authority, commercial predecessor evidence, and mutable provider truth', async () => {
  const docs = await source(docsPath);
  const authorityDocs = await source(authorityDocsPath);

  assert.match(docs, /exact four-field refund authority/i);
  assert.match(docs, /does not freeze payment provider lifecycle status/i);
  assert.match(docs, /SETTLEMENT_DRIFT/);
  assert.match(docs, /Newly issued schema-version-2-through-5 commercial adjustment notes now freeze/i);
  assert.match(docs, /Pre-migration commercial predecessor notes are not backfilled/i);
  assert.match(authorityDocs, /does \*\*not\*\* re-run cancellation readiness/i);
  assert.match(authorityDocs, /sf_hospitality_v6_refund_authorities_valid/);
  assert.match(authorityDocs, /cancellation-refund-authority-database-integrity\.md/);
  assert.match(authorityDocs, /New schema-version-2-through-5 commercial adjustment notes now carry immutable issue-time settlement evidence/i);
});
