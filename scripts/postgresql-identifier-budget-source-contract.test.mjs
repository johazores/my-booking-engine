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
  return [
    ...sql.matchAll(/\b(?:CONSTRAINT|INDEX|TRIGGER)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"([^"]+)"/gi),
    ...sql.matchAll(/\bRENAME\s+TO\s+"([^"]+)"/gi),
  ].map((match) => match[1]);
}

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
