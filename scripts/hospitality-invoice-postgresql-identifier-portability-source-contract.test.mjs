import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const byteLength = (name) => Buffer.byteLength(name, 'utf8');
const storedName = (name) => Buffer.from(name, 'utf8').subarray(0, 63).toString('utf8');

const adjustmentMigration = read('prisma/migrations/20260904060000_hospitality-adjustment-notes/migration.sql');
const portabilityMigration = read('prisma/migrations/20260922111500-hospitality-invoice-identifier-portability/migration.sql');
const invoiceSchema = read('prisma/invoice-foundation.prisma');

const legacyName = 'hospitality_issued_adjustment_notes_org_jurisdiction_type_sequence_key';
const finalName = 'hospitality_adj_notes_org_jurisdiction_type_sequence_key';

test('adjustment-note foundation has only the known overlong physical identifier', () => {
  const schemaObjectNames = [...adjustmentMigration.matchAll(/(?:CONSTRAINT|INDEX)\s+"([^"]+)"/g)].map(
    (match) => match[1],
  );
  const overlongNames = schemaObjectNames.filter((name) => byteLength(name) > 63);

  assert.deepEqual(overlongNames, [legacyName]);
  assert.equal(byteLength(legacyName), 70);
  assert.equal(byteLength(storedName(legacyName)), 63);
  assert.notEqual(
    storedName(legacyName),
    'hospitality_issued_adjustment_notes_org_jurisdiction_number_key',
  );
});

test('portability migration renames the exact PostgreSQL-stored index without rebuilding evidence', () => {
  const renames = [...portabilityMigration.matchAll(/ALTER INDEX "([^"]+)"\s+RENAME TO "([^"]+)"/g)].map(
    (match) => [match[1], match[2]],
  );

  assert.deepEqual(renames, [[storedName(legacyName), finalName]]);
  assert.equal(byteLength(renames[0][0]), 63);
  assert.ok(byteLength(finalName) <= 63);
  assert.doesNotMatch(portabilityMigration, /\b(?:CREATE|DROP|INSERT|UPDATE|DELETE)\b/i);
});

test('Prisma maps the final compact adjustment-note numbering index', () => {
  assert.doesNotMatch(invoiceSchema, new RegExp(`map: "${legacyName}"`));
  assert.match(
    invoiceSchema,
    new RegExp(
      `@@unique\\(\\[organizationId, jurisdictionCode, documentType, sequenceValue\\], map: "${finalName}"\\)`,
    ),
  );
});

test('all explicit invoice schema physical names fit PostgreSQL identifier limits', () => {
  const mappedNames = [...invoiceSchema.matchAll(/map:\s*"([^"]+)"/g)].map((match) => match[1]);

  assert.ok(mappedNames.length > 0);
  for (const name of mappedNames) {
    assert.ok(byteLength(name) <= 63, `${name} exceeds PostgreSQL's 63-byte identifier limit`);
  }
  assert.equal(new Set(mappedNames).size, mappedNames.length);
});
