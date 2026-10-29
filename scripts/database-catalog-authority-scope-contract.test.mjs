import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('commercial settlement catalog assertions bind current-schema tables, enabled triggers, handlers, and row events', () => {
  const file = source('src/server/payments/hospitality-commercial-settlement-evidence-database-integrity.integration.ts');
  assert.match(file, /JOIN pg_namespace namespace_row ON namespace_row\.oid = relation_row\.relnamespace/);
  assert.equal((file.match(/namespace_row\.nspname = current_schema\(\)/g) ?? []).length, 2);
  assert.match(file, /trigger_row\.tgenabled::text AS enabled/);
  assert.match(file, /JOIN pg_proc handler_row ON handler_row\.oid = trigger_row\.tgfoid/);
  assert.match(file, /JOIN pg_namespace handler_namespace ON handler_namespace\.oid = handler_row\.pronamespace/);
  assert.match(file, /handler_namespace\.nspname = current_schema\(\)/);
  assert.match(file, /relation_row\.relkind = 'r'/);
  assert.match(file, /handler_row\.pronargs = 0/);
  assert.match(file, /handler_row\.prorettype = 'pg_catalog\.trigger'::regtype/);
  assert.match(file, /trigger_row\.tgtype::integer AS event_type/);
  assert.match(file, /assert\.equal\(row\.handler_name, expectedHandlers\.get\(row\.trigger_name\)/);
  assert.match(file, /assert\.equal\(row\.event_type, expectedEvents\.get\(row\.trigger_name\)/);
  assert.equal((file.match(/'hospitality_commercial_settlement_evidence_(?:tx_)?insert_guard', 7/g) ?? []).length, 2);
  assert.match(file, /'hospitality_commercial_settlement_evidence_continuity_guard', 5/);
  assert.match(file, /assert\.equal\(row\.enabled, 'O'/);
  assert.match(file, /assert\.equal\(row\.table_name, expectedTables\.get\(row\.trigger_name\)/);
  for (const table of ['hospitality_commercial_settlement_evidence', 'hospitality_commercial_settlement_evidence_transactions']) {
    assert.ok(file.includes(`'${table}'`), `missing expected catalog table ${table}`);
  }
  const expectedBindings = [
    ['hospitality_commercial_settlement_evidence_insert_guard', 'sf_validate_hospitality_commercial_settlement_evidence_insert'],
    ['hospitality_commercial_settlement_evidence_tx_insert_guard', 'sf_validate_hospitality_commercial_settlement_tx_insert'],
    ['hospitality_commercial_settlement_evidence_continuity_guard', 'sf_check_hospitality_commercial_settlement_evidence_continuity'],
  ];
  const migrationSources = [
    source('prisma/migrations/20260924222000-hospitality-commercial-settlement-evidence/migration.sql'),
    source('prisma/migrations/20260924233000-hospitality-commercial-settlement-evidence-integrity/migration.sql'),
  ];
  for (const [triggerName, handlerName] of expectedBindings) {
    assert.ok(file.includes(`['${triggerName}', '${handlerName}']`), `${triggerName} must bind the intended handler`);
    assert.ok(migrationSources.some((migration) =>
      migration.includes(`TRIGGER ${triggerName}`) &&
      migration.includes(`EXECUTE FUNCTION ${handlerName}();`)
    ), `${triggerName} must be backed by the checked-in migration`);
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

test('rental security bond catalog checks bind enabled triggers to real tables, functions, and events', () => {
  const file = source('src/server/payments/rental-security-bond.integration.ts');
  for (const required of [
    'JOIN pg_namespace n ON n.oid = c.relnamespace',
    'WHERE n.nspname = current_schema()',
    'JOIN pg_proc p ON p.oid = t.tgfoid',
    'JOIN pg_namespace pn ON pn.oid = p.pronamespace',
    'pn.nspname = current_schema()',
    "c.relkind = 'r'",
    'p.pronargs = 0',
    "p.prorettype = 'pg_catalog.trigger'::regtype",
    't.tgtype::integer AS "eventType"',
  ]) {
    assert.equal(file.split(required).length - 1, 2, required);
  }
  assert.ok(file.includes('eventType: 31'));
  assert.equal(file.split('eventType: 7').length - 1, 3);

  const forfeitureMigration = source('prisma/migrations/20260917060000_rental_security_bond_forfeiture/migration.sql');
  const chronologyMigration = source('prisma/migrations/20261015013000-rental-bond-liability-return-chronology/migration.sql');
  for (const [trigger, handler, migration] of [
    ['rental_security_bond_forfeitures_authority_guard', 'sf_author_rental_security_bond_forfeiture', forfeitureMigration],
    ['rental_security_bond_forfeitures_chronology_guard', 'sf_guard_rental_bond_liability_return_chronology', chronologyMigration],
    ['rental_security_bond_transactions_forfeiture_guard', 'sf_guard_rental_security_bond_release_after_forfeiture', forfeitureMigration],
    ['rental_damage_settlement_transactions_bond_forfeiture_guard', 'sf_guard_rental_damage_settlement_against_bond_forfeiture', forfeitureMigration],
  ]) {
    assert.ok(file.includes("name: '" + trigger + "', enabled: 'O', handler: '" + handler + "'"), trigger);
    assert.ok(migration.includes('CREATE TRIGGER ' + trigger), trigger);
    assert.ok(migration.includes('EXECUTE FUNCTION ' + handler + '()'), handler);
  }
});

test('refund authority constraint catalog check is scoped to the current schema', () => {
  const file = source('src/server/payments/hospitality-v6-refund-authority-database-integrity.integration.ts');
  assert.match(file, /JOIN pg_namespace namespace_row ON namespace_row\.oid = relation_row\.relnamespace/);
  assert.match(file, /namespace_row\.nspname = current_schema\(\)/);
  assert.match(file, /constraint_row\.convalidated/);
  assert.ok(file.includes("relation_row.relkind = 'r'"));
  assert.ok(file.includes("constraint_row.contype = 'c'"));
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
