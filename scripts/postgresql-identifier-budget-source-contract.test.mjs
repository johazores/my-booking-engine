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

// PostgreSQL block comments can nest. A non-greedy block-comment regex
// would stop at the inner */ and mistake the remaining comment for a column.
function stripLeadingSqlTrivia(segment) {
  let index = 0;
  while (index < segment.length) {
    if (/\s/.test(segment[index])) { index += 1; continue; }
    if (segment.startsWith('--', index)) {
      const newline = segment.indexOf('\n', index + 2);
      index = newline < 0 ? segment.length : newline + 1;
      continue;
    }
    if (segment.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (depth && index < segment.length) {
        if (segment.startsWith('/*', index)) { depth += 1; index += 2; }
        else if (segment.startsWith('*/', index)) { depth -= 1; index += 2; }
        else index += 1;
      }
      continue;
    }
    break;
  }
  return segment.slice(index);
}

// Exclude non-executable SQL text, preserving quoted identifiers and positions.
function maskSqlNonCode(sql) {
  const masked = sql.split('');
  const blank = (start, end) => {
    for (let position = start; position < end; position += 1) {
      if (sql[position] !== '\n' && sql[position] !== '\r') masked[position] = ' ';
    }
  };
  let index = 0;
  while (index < sql.length) {
    const start = index;
    if (sql.startsWith('--', index)) {
      const newline = sql.indexOf('\n', index + 2);
      index = newline < 0 ? sql.length : newline;
      blank(start, index);
      continue;
    }
    if (sql.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith('/*', index)) { depth += 1; index += 2; }
        else if (sql.startsWith('*/', index)) { depth -= 1; index += 2; }
        else index += 1;
      }
      blank(start, index);
      continue;
    }
    if (sql[index] === '"') {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === '"') {
          index += 1;
          if (sql[index] === '"') index += 1;
          else break;
        } else index += 1;
      }
      continue;
    }
    if (sql[index] === "'") {
      const escapeString = /[eE]/.test(sql[index - 1] ?? '') &&
        (index === 1 || !/[A-Za-z0-9_$]/.test(sql[index - 2]));
      index += 1;
      while (index < sql.length) {
        if (escapeString && sql[index] === '\\') {
          index += Math.min(2, sql.length - index);
          continue;
        }
        if (sql[index] === "'") {
          index += 1;
          if (sql[index] === "'") index += 1;
          else break;
        } else index += 1;
      }
      blank(start, index);
      continue;
    }
    if (sql[index] === '$' && (index === 0 || !/[A-Za-z0-9_$]/.test(sql[index - 1]))) {
      const tag = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        const closing = sql.indexOf(tag, index + tag.length);
        index = closing < 0 ? sql.length : closing + tag.length;
        blank(start, index);
        continue;
      }
    }
    index += 1;
  }
  return masked.join('');
}

function createdTableColumns(sql) {
  const names = [];
  const head = /\bCREATE\s+(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)\s*\(/gi;
  const skip = new Set(['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'EXCLUDE', 'LIKE']);
  const add = (segment) => {
    const clean = stripLeadingSqlTrivia(segment);
    const match = clean.match(/^(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))(?=\s|$)/);
    if (match && !skip.has((match[2] ?? '').toUpperCase())) names.push((match[1] ?? match[2]).replaceAll('""', '"'));
  };
  for (const match of sql.matchAll(head)) {
    let depth = 1;
    let start = match.index + match[0].length;
    let quote = null;
    let blockDepth = 0;
    let lineComment = false;
    let dollarTag = null;
    for (let i = start; i < sql.length; i += 1) {
      const char = sql[i];
      const next = sql[i + 1];
      if (lineComment) { if (char === '\n') lineComment = false; continue; }
      if (blockDepth) {
        if (char === '/' && next === '*') { blockDepth += 1; i += 1; }
        else if (char === '*' && next === '/') { blockDepth -= 1; i += 1; }
        continue;
      }
      if (dollarTag) {
        if (sql.startsWith(dollarTag, i)) { i += dollarTag.length - 1; dollarTag = null; }
        continue;
      }
      if (quote) {
        if (char === quote) {
          if (next === quote) i += 1;
          else quote = null;
        }
        continue;
      }
      if (char === '-' && next === '-') { lineComment = true; i += 1; continue; }
      if (char === '/' && next === '*') { blockDepth = 1; i += 1; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '$') {
        const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
        if (tag) { dollarTag = tag; i += tag.length - 1; continue; }
      }
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) { add(sql.slice(start, i)); break; }
      } else if (char === ',' && depth === 1) { add(sql.slice(start, i)); start = i + 1; }
    }
  }
  return names;
}

function physicalNames(source) {
  const sql = maskSqlNonCode(source);
  // PostgreSQL escapes double quotes inside quoted identifiers as "".
  const quoted = [
    ...sql.matchAll(/\b(?:CONSTRAINT|TRIGGER)\s+(?:CONCURRENTLY\s+)?(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"((?:[^"]|"")+)"/gi),
    ...sql.matchAll(/\bRENAME\s+TO\s+"((?:[^"]|"")+)"/gi),
  ].map((match) => match[1].replaceAll('""', '"'));
  const unquoted = [
    ...sql.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+([A-Za-z_][A-Za-z0-9_$]*)/gi),
    ...sql.matchAll(/\b(?:ADD\s+CONSTRAINT|RENAME\s+TO)\s+([A-Za-z_][A-Za-z0-9_$]*)/gi),
    ...sql.matchAll(/(?:\(|,)\s*CONSTRAINT\s+([A-Za-z_][A-Za-z0-9_$]*)/gi),
  ].map((match) => match[1]);
  // Index names may be schema-qualified. Budget the final identifier, not
  // the preceding schema name (which is not the created index).
  const createdIndexes = [
    ...sql.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))\s+ON\b/gi),
  ].map((match) => (match[1] ?? match[2]).replaceAll('""', '"'));
  // Raw SQL functions and tables have no necessary Prisma map. Include other
  // common named CREATE objects, with optional schema qualification.
  const createdObjects = [
    ...sql.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?(?:TABLE|FUNCTION|PROCEDURE|SEQUENCE|MATERIALIZED\s+VIEW|VIEW|TYPE|DOMAIN|SCHEMA|POLICY)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))/gi),
  ].map((match) => (match[1] ?? match[2]).replaceAll('""', '"'));
  // ALTER TABLE can introduce physical column identifiers without a Prisma
  // @map. Only inspect new ADD COLUMN names and RENAME COLUMN destinations;
  // an old rename source may intentionally be a legacy truncated identifier.
  const alteredColumns = [
    ...sql.matchAll(/\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))/gi),
    ...sql.matchAll(/\bRENAME\s+COLUMN\s+(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)\s+TO\s+(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))/gi),
  ].map((match) => (match[1] ?? match[2]).replaceAll('""', '"'));
  // PostgreSQL also accepts ALTER TABLE ... ADD name type without COLUMN.
  // Exclude table-level constraint forms and let ADD COLUMN use the scanner above.
  const addedColumnsWithoutKeyword = [
    ...sql.matchAll(/\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)\s+ADD\s+(?:IF\s+NOT\s+EXISTS\s+)?(?!COLUMN\b|CONSTRAINT\b|CHECK\b|UNIQUE\b|PRIMARY\b|FOREIGN\b|EXCLUDE\b)(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))\s+/gi),
  ].map((match) => (match[1] ?? match[2]).replaceAll('""', '"'));
  return [...quoted, ...unquoted, ...createdIndexes, ...createdObjects, ...alteredColumns, ...addedColumnsWithoutKeyword, ...createdTableColumns(sql)];
}

test('commented and literal DDL does not create phantom physical identifiers', () => {
  const phantom = 'phantom_' + 'x'.repeat(64);
  const names = physicalNames([
    '-- CREATE INDEX "' + phantom + '" ON "t"("id");',
    '/* outer /* CREATE TABLE "' + phantom + '" ("id" INTEGER); */ CREATE TRIGGER "' + phantom + '" BEFORE INSERT ON "t" EXECUTE FUNCTION f(); */',
    '/* ALTER TABLE "t" ADD COLUMN "' + phantom + '" TEXT; */',
    'SELECT ' + "'" + 'CREATE INDEX "' + phantom + '" ON "t"("id");' + "'" + ';',
    'DO $body$ BEGIN EXECUTE ' + "'" + 'CREATE TABLE "' + phantom + '" ("id" INTEGER);' + "'" + '; END; $body$;',
    'SELECT $$ALTER TABLE "t" RENAME COLUMN "old" TO "' + phantom + '";$$;',
    'CREATE TABLE "real_table" ("real_column" TEXT);',
    'CREATE INDEX "real_index" ON "real_table" ("real_column");',
  ].join('\n'));
  assert.ok(!names.includes(phantom), 'comments and literals must not produce DDL names');
  for (const name of ['real_table', 'real_column', 'real_index']) {
    assert.ok(names.includes(name), 'missing executable DDL name: ' + name);
  }
});

test('escaped strings and quoted identifiers retain executable column authority', () => {
  const phantom = 'phantom_' + 'x'.repeat(64);
  const names = physicalNames([
    "SELECT E'escaped \\' CREATE INDEX \"" + phantom + "\" ON t(id)';",
    'CREATE TABLE "quoted' + "'" + 'table" ("quoted' + "'" + 'column" TEXT DEFAULT ' + "'" + 'hello, (world)' + "'" + ', "real""column" TEXT DEFAULT $$CREATE INDEX "' + phantom + '" ON t(id)$$);',
  ].join('\n'));
  for (const name of ["quoted'table", "quoted'column", 'real"column']) {
    assert.ok(names.includes(name), 'missing quoted executable identifier: ' + name);
  }
  assert.ok(!names.includes(phantom), 'string content must not be scanned as executable DDL');
});

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
    'CREATE OR REPLACE FUNCTION "audit"."sf_commercial_authority"() RETURNS integer LANGUAGE sql AS $body$ SELECT 1 $body$;',
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
    'CREATE FUNCTION ' + escaped + '() RETURNS integer LANGUAGE sql AS $body$ SELECT 1 $body$; ' +
    'CREATE INDEX ' + escaped + ' ON "t"("id");',
  );
  assert.ok(names.filter((name) => name === longName).length >= 2);
  assert.ok(byteLength(longName) > MAX_POSTGRES_IDENTIFIER_BYTES);
});

test('ALTER TABLE added columns and rename destinations are inspected without confusing other ADD statements', () => {
  const names = physicalNames([
    'ALTER TABLE "t" ADD COLUMN IF NOT EXISTS "new""column" TEXT;',
    'ALTER TABLE "t" ADD COLUMN unquoted_column INTEGER;',
    'ALTER TABLE "t" RENAME COLUMN "old""column" TO "renamed""column";',
    'ALTER TABLE "t" ADD CONSTRAINT "existing_constraint" CHECK (true);',
    "ALTER TYPE \"state\" ADD VALUE 'next';",
  ].join('\n'));
  for (const name of ['new"column', 'unquoted_column', 'renamed"column']) {
    assert.ok(names.includes(name), 'missing new physical column: ' + name);
  }
  assert.ok(!names.includes('COLUMN'), 'SQL keyword is not a physical identifier');
  assert.ok(!names.includes('VALUE'), 'enum value additions are not column declarations');
  assert.ok(!names.includes('old"column'), 'legacy rename sources are not newly created names');
});

test('ALTER TABLE column additions and rename targets enforce the UTF-8 byte budget', () => {
  const unquoted = 'new_' + 'x'.repeat(64);
  const quoted = '名'.repeat(22);
  const names = physicalNames(
    'ALTER TABLE "t" ADD COLUMN ' + unquoted + ' INTEGER; ' +
    'ALTER TABLE "t" RENAME COLUMN "old" TO "' + quoted + '";',
  );
  assert.ok(names.includes(unquoted));
  assert.ok(names.includes(quoted));
  assert.ok(byteLength(unquoted) > MAX_POSTGRES_IDENTIFIER_BYTES);
  assert.ok(byteLength(quoted) > MAX_POSTGRES_IDENTIFIER_BYTES);
});

test('schema-qualified index declarations budget the created index rather than its schema', () => {
  const longName = 'index_' + 'x'.repeat(64);
  const names = physicalNames([
    'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "audit"."new""idx" ON "t"("id");',
    'CREATE INDEX audit.plain_idx ON "t"("id");',
    'CREATE INDEX "audit"."' + longName + '" ON "t"("id");',
  ].join('\n'));
  for (const name of ['new"idx', 'plain_idx', longName]) {
    assert.ok(names.includes(name), 'missing index identifier: ' + name);
  }
  assert.ok(!names.includes('audit'), 'schema name must not substitute for the index name');
  assert.ok(byteLength(longName) > MAX_POSTGRES_IDENTIFIER_BYTES);
});

test('CREATE TABLE column lists budget actual names across nested SQL expressions', () => {
  const longName = '名'.repeat(22);
  const names = physicalNames([
    'CREATE TABLE IF NOT EXISTS "audit"."complex" (',
    '  "new""column" TEXT DEFAULT ' + "'hello, (world)'" + ',',
    '  -- a comment with commas and parentheses (,) ',
    '  "' + longName + '" TEXT,',
    '  unquoted_column INTEGER,',
    '  CONSTRAINT "shape_check" CHECK (unquoted_column IN (1, 2)),',
    '  PRIMARY KEY (unquoted_column),',
    '  "literal" TEXT DEFAULT $$hello, (world)$$,',
    '  /* ignored, ( */ "last_column" INTEGER',
    ');',
  ].join('\n'));
  for (const name of ['new"column', longName, 'unquoted_column', 'literal', 'last_column']) {
    assert.ok(names.includes(name), 'missing table column: ' + name);
  }
  assert.ok(!names.includes('PRIMARY'), 'table-level primary keys are not columns');
  assert.ok(!names.includes('CHECK'), 'table-level constraints are not columns');
  assert.ok(byteLength(longName) > MAX_POSTGRES_IDENTIFIER_BYTES);
});

test('CREATE TABLE nested leading block comments cannot hide or invent column names', () => {
  const longName = '名'.repeat(22);
  const names = physicalNames([
    'CREATE TABLE "nested_comments" (',
    '  /* outer /* inner */ trailing */ "' + longName + '" TEXT,',
    '  /* outer /* inner */ trailing */ -- before next column',
    '  "escaped""column" TEXT,',
    '  /* outer /* inner */ trailing */ CONSTRAINT "nested_check" CHECK (true)',
    ');',
  ].join('\n'));
  for (const name of [longName, 'escaped"column', 'nested_check']) {
    assert.ok(names.includes(name), 'missing real physical identifier: ' + name);
  }
  assert.ok(!names.includes('trailing'), 'nested comment text is not a column');
  assert.ok(!names.includes('CONSTRAINT'), 'table-level constraint keyword is not a column');
  assert.ok(byteLength(longName) > MAX_POSTGRES_IDENTIFIER_BYTES);
});

test('ALTER TABLE ADD without COLUMN also budgets physical names', () => {
  const names = physicalNames([
    'ALTER TABLE "audit"."t" ADD IF NOT EXISTS "new""column" TEXT;',
    'ALTER TABLE "t" ADD plain_column INTEGER;',
    'ALTER TABLE "t" ADD CONSTRAINT "shape_check" CHECK (true);',
    'ALTER TABLE "t" ADD CHECK (true);',
  ].join('\n'));
  for (const name of ['new"column', 'plain_column']) {
    assert.ok(names.includes(name), 'missing ADD column: ' + name);
  }
  assert.ok(!names.includes('CONSTRAINT'), 'constraint keywords are not columns');
  assert.ok(!names.includes('CHECK'), 'CHECK is not a column declaration');
});

test('forward migration CREATE TABLE declarations include all auth quota columns', () => {
  const sql = readFileSync(
    new URL('../prisma/migrations/20261030062500_auth_attempt_windows/migration.sql', import.meta.url),
    'utf8',
  );
  const names = physicalNames(sql);
  for (const name of ['operation', 'scope', 'subjectHash', 'windowStart', 'attempts']) {
    assert.ok(names.includes(name), 'missing auth quota table column: ' + name);
  }
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
