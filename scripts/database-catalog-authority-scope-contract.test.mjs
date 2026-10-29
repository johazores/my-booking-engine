import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('commercial settlement catalog assertions target the current schema, real tables, and enabled trigger functions', () => {
  const file = source('src/server/payments/hospitality-commercial-settlement-evidence-database-integrity.integration.ts');
  assert.match(file, /JOIN pg_namespace namespace_row ON namespace_row\.oid = relation_row\.relnamespace/);
  assert.equal((file.match(/namespace_row\.nspname = current_schema\(\)/g) ?? []).length, 2);
  assert.match(file, /trigger_row\.tgenabled::text AS enabled/);
  assert.match(file, /assert\.equal\(row\.enabled, 'O'/);
  assert.match(file, /assert\.equal\(row\.table_name, expectedTables\.get\(row\.trigger_name\)/);
  for (const table of ['hospitality_commercial_settlement_evidence', 'hospitality_commercial_settlement_evidence_transactions']) {
    assert.ok(file.includes(`'${table}'`), `missing expected catalog table ${table}`);
  }
  assert.match(file, /procedure_row\.pronargs = 0/);
  assert.match(file, /procedure_row\.prorettype = 'pg_catalog\.trigger'::regtype/);
  for (const functionName of [
    'sf_validate_hospitality_commercial_settlement_evidence_insert',
    'sf_validate_hospitality_commercial_settlement_tx_insert',
    'sf_check_hospitality_commercial_settlement_evidence_continuity',
  ]) {
    assert.ok(file.includes(functionName), `missing expected trigger function ${functionName}`);
  }
});

test('rental security bond catalog checks cannot match a table in a different schema', () => {
  const file = source('src/server/payments/rental-security-bond.integration.ts');
  assert.equal((file.match(/JOIN pg_namespace n ON n\.oid = c\.relnamespace/g) ?? []).length, 2);
  assert.equal((file.match(/n\.nspname = current_schema\(\)/g) ?? []).length, 2);
  assert.match(file, /assert\.deepEqual\(chronologyTriggers, \[\{ enabled: 'O' \}\]\)/);
  assert.match(file, /assert\.deepEqual\(exclusivityTriggers, \[/);
});

test('refund authority constraint catalog check is scoped to the current schema', () => {
  const file = source('src/server/payments/hospitality-v6-refund-authority-database-integrity.integration.ts');
  assert.match(file, /JOIN pg_namespace namespace_row ON namespace_row\.oid = relation_row\.relnamespace/);
  assert.match(file, /namespace_row\.nspname = current_schema\(\)/);
  assert.match(file, /constraint_row\.convalidated/);
});

test('Stripe catalog check requires the current schema and ordinary payment table, not search_path fallback', () => {
  const file = source('src/server/payments/stripe-reference-database-constraints.integration.ts');
  assert.match(file, /JOIN pg_namespace table_namespace ON table_namespace\.oid = table_class\.relnamespace/);
  assert.match(file, /table_namespace\.nspname = current_schema\(\)/);
  assert.match(file, /table_class\.relname = 'payment_transactions'/);
  assert.match(file, /table_class\.relkind = 'r'/);
  assert.doesNotMatch(file, /to_regclass\('payment_transactions'\)/);
  assert.match(file, /constraint_row\.conrelid = table_class\.oid/);
});
