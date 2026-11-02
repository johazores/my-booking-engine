import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const MAX_POSTGRES_IDENTIFIER_BYTES = 63;
const ENFORCEMENT_BASELINE = '20260922111500-hospitality-invoice-identifier-portability';
const migrationsDirectory = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));

const byteLength = (name) => Buffer.byteLength(name, 'utf8');

function migrationDirectoriesFromBaseline() {
  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.localeCompare(ENFORCEMENT_BASELINE) >= 0)
    .map((entry) => entry.name)
    .sort();
}

function physicalNames(sql) {
  // PostgreSQL escapes double quotes inside quoted identifiers as "".
  const quoted = [
    ...sql.matchAll(/\b(?:CONSTRAINT|INDEX|TRIGGER)\s+(?:CONCURRENTLY\s+)?(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"((?:[^"]|"")+)"/gi),
    ...sql.matchAll(/\bRENAME\s+TO\s+"((?:[^"]|"")+)"/gi),
  ].map((match) => match[1].replaceAll('""', '"'));
  const unquoted = [
    ...sql.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+([A-Za-z_][A-Za-z0-9_$]*)/gi),
    ...sql.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_$]*)\s+ON\b/gi),
    ...sql.matchAll(/\b(?:ADD\s+CONSTRAINT|RENAME\s+TO)\s+([A-Za-z_][A-Za-z0-9_$]*)/gi),
    ...sql.matchAll(/(?:\(|,)\s*CONSTRAINT\s+([A-Za-z_][A-Za-z0-9_$]*)/gi),
  ].map((match) => match[1]);
  // Raw SQL functions and tables have no necessary Prisma map. Include other
  // common named CREATE objects, with optional schema qualification.
  const createdObjects = [
    ...sql.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?(?:TABLE|FUNCTION|PROCEDURE|SEQUENCE|MATERIALIZED\s+VIEW|VIEW|TYPE|DOMAIN|SCHEMA|POLICY)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))/gi),
  ].map((match) => (match[1] ?? match[2]).replaceAll('""', '"'));
  return [...quoted, ...unquoted, ...createdObjects];
}

test('identifier budget includes unquoted DDL and concurrent index names', () => {
  const names = physicalNames(`
    CREATE TRIGGER unquoted_trigger BEFORE INSERT ON "t" EXECUTE FUNCTION f();
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS unquoted_idx ON "t"("id");
    CREATE INDEX CONCURRENTLY "quoted_idx" ON "t"("id");
    ALTER TABLE "t" ADD CONSTRAINT unquoted_fk FOREIGN KEY ("id") REFERENCES "t"("id");
    CREATE TABLE "a" ("id" integer, CONSTRAINT inline_check CHECK ("id" > 0));
    ALTER INDEX old_idx RENAME TO renamed_idx;
  `);
  for (const name of ['unquoted_trigger', 'unquoted_idx', 'quoted_idx', 'unquoted_fk', 'inline_check', 'renamed_idx']) {
    assert.ok(names.includes(name), `missing physical identifier: ${name}`);
  }
  assert.ok(!names.includes('CONCURRENTLY'), 'SQL keyword is not an index name');
});

test('identifier budget catches long unquoted and multibyte physical names', () => {
  const unquoted = `guard_${'x'.repeat(64)}`;
  const quoted = '名'.repeat(22);
  const names = physicalNames(`CREATE TRIGGER ${unquoted} BEFORE INSERT ON "t" EXECUTE FUNCTION f(); CREATE INDEX "${quoted}" ON "t"("id");`);
  assert.ok(names.includes(unquoted));
  assert.ok(names.includes(quoted));
  assert.ok(byteLength(unquoted) > MAX_POSTGRES_IDENTIFIER_BYTES);
  assert.ok(byteLength(quoted) > MAX_POSTGRES_IDENTIFIER_BYTES);
});

test('known unquoted forward migration triggers are included in the budget', () => {
  const cases = [
    ['20260924222000-hospitality-commercial-settlement-evidence', [
      'hospitality_commercial_settlement_evidence_insert_guard',
      'hospitality_commercial_settlement_evidence_count_guard',
      'hospitality_commercial_settlement_evidence_tx_count_guard',
      'hospitality_commercial_settlement_evidence_capture',
      'hospitality_commercial_settlement_evidence_mutation_guard',
      'hospitality_commercial_settlement_evidence_tx_mutation_guard',
    ]],
    ['20260924233000-hospitality-commercial-settlement-evidence-integrity', [
      'hospitality_commercial_settlement_evidence_tx_insert_guard',
      'hospitality_commercial_settlement_evidence_continuity_guard',
    ]],
    ['20261012073000-rental-effective-refund-source-order', [
      'rental_effective_refund_source_order_guard',
    ]],
    ['20261015013000-rental-bond-liability-return-chronology', [
      'rental_security_bond_forfeitures_chronology_guard',
    ]],
  ];
  for (const [directory, expectedNames] of cases) {
    const sql = readFileSync(new URL(`../prisma/migrations/${directory}/migration.sql`, import.meta.url), 'utf8');
    const found = physicalNames(sql);
    for (const name of expectedNames) {
      assert.ok(found.includes(name), `${directory}: unquoted trigger ${name} was not inspected`);
    }
  }
});

test('budget includes raw SQL functions, tables, and schema-qualified named DDL', () => {
  const names = physicalNames([
    'CREATE OR REPLACE FUNCTION "audit"."sf_commercial_authority"() RETURNS void AS $ SELECT 1 $ LANGUAGE sql;',
    'CREATE TABLE IF NOT EXISTS "audit"."settlement_evidence" ("id" integer);',
    'CREATE UNLOGGED TABLE scratch_rows ("id" integer);',
    'CREATE MATERIALIZED VIEW "audit"."settlement_rollup" AS SELECT 1;',
    'CREATE SEQUENCE "audit"."settlement_sequence";',
    'CREATE POLICY tenant_read_policy ON "settlement_evidence" USING (true);',
  ].join('\n'));
  for (const name of [
    'sf_commercial_authority', 'settlement_evidence', 'scratch_rows',
    'settlement_rollup', 'settlement_sequence', 'tenant_read_policy',
  ]) {
    assert.ok(names.includes(name), 'missing physical identifier: ' + name);
  }
});

test('escaped quotes cannot conceal an overlong physical identifier', () => {
  const longName = 'audit"' + 'x'.repeat(65);
  const escaped = '"audit""' + 'x'.repeat(65) + '"';
  const names = physicalNames(
    'CREATE FUNCTION ' + escaped + '() RETURNS void AS $ SELECT 1 $ LANGUAGE sql; ' +
    'CREATE INDEX ' + escaped + ' ON "t"("id");',
  );
  assert.ok(names.filter((name) => name === longName).length >= 2);
  assert.ok(byteLength(longName) > MAX_POSTGRES_IDENTIFIER_BYTES);
});

test('commercial evidence raw SQL functions and tables are inspected', () => {
  const directory = '20260924222000-hospitality-commercial-settlement-evidence';
  const sql = readFileSync(new URL('../prisma/migrations/' + directory + '/migration.sql', import.meta.url), 'utf8');
  const names = physicalNames(sql);
  for (const name of [
    'hospitality_commercial_settlement_evidence',
    'hospitality_commercial_settlement_evidence_transactions',
    'sf_validate_hospitality_commercial_settlement_evidence_insert',
    'sf_guard_hospitality_commercial_settlement_evidence_mutation',
  ]) {
    assert.ok(names.includes(name), 'missing forward SQL object: ' + name);
  }
});

test('PostgreSQL identifier-budget enforcement starts from a real checked-in migration', () => {
  const migrationDirectories = migrationDirectoriesFromBaseline();

  assert.ok(migrationDirectories.length > 0);
  assert.equal(migrationDirectories[0], ENFORCEMENT_BASELINE);
});

test('new migration constraints, indexes, triggers, and rename targets fit PostgreSQL identifier limits', () => {
  const violations = [];
  let inspectedNames = 0;

  for (const directory of migrationDirectoriesFromBaseline()) {
    const migrationPath = new URL(`../prisma/migrations/${directory}/migration.sql`, import.meta.url);
    const sql = readFileSync(migrationPath, 'utf8');

    for (const name of physicalNames(sql)) {
      inspectedNames += 1;
      const bytes = byteLength(name);
      if (bytes > MAX_POSTGRES_IDENTIFIER_BYTES) {
        violations.push(`${directory}: ${name} (${bytes} bytes)`);
      }
    }
  }

  assert.ok(inspectedNames > 0, 'expected to inspect at least one PostgreSQL physical identifier');
  assert.deepEqual(violations, []);
});
