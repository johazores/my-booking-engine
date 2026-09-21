import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const foundationMigration = read('prisma/migrations/20260904034500_hospitality-issued-invoices/migration.sql');
const migration = read('prisma/migrations/20260922033000-hospitality-invoice-number-sequence-integrity/migration.sql');
const integration = read('src/server/payments/hospitality-invoice-number-sequence-integrity.integration.ts');
const runner = read('scripts/run-database-tests.mjs');
const docs = read('docs/invoice-number-sequence-integrity.md');

test('migration protects sequence identity and exact single-step advancement', () => {
  assert.match(migration, /sf_guard_hospitality_invoice_number_sequence_update/);
  assert.match(migration, /sequence identity is immutable/i);
  assert.match(migration, /must advance exactly one value at a time/i);
  assert.match(migration, /BEFORE UPDATE ON "hospitality_invoice_number_sequences"/);
});

test('supported sequence constraint does not collide with the foundation migration', () => {
  assert.match(
    foundationMigration,
    /CONSTRAINT "hospitality_invoice_number_sequences_document_type_check"/,
  );
  assert.doesNotMatch(
    migration,
    /ADD CONSTRAINT hospitality_invoice_number_sequences_document_type_check\b/,
  );
  assert.match(
    migration,
    /ADD CONSTRAINT hospitality_invoice_number_sequences_supported_document_type_check/,
  );
});

test('deferred integrity checks bind both legal-document ledgers to their counters', () => {
  assert.match(migration, /sf_assert_hospitality_invoice_number_sequence_integrity/);
  assert.match(migration, /hospitality_invoice_number_sequence_integrity_guard/);
  assert.match(migration, /hospitality_issued_invoice_number_sequence_guard/);
  assert.match(migration, /hospitality_issued_adjustment_note_number_sequence_guard/);
  assert.ok((migration.match(/DEFERRABLE INITIALLY DEFERRED/g) ?? []).length >= 3);
  assert.match(migration, /minimum_value <> 1/);
  assert.match(migration, /maximum_value <> issued_count/);
  assert.match(migration, /current_next_value <> maximum_value \+ 1/);
});

test('legal numbering shape and document identity are constrained independently of application code', () => {
  assert.match(migration, /hospitality_invoice_number_sequences_supported_document_type_check/);
  assert.match(migration, /hospitality_invoice_number_sequences_next_positive_check/);
  assert.match(migration, /hospitality_issued_invoices_document_type_check/);
  assert.match(migration, /hospitality_issued_adjustment_notes_document_type_check/);
  assert.match(migration, /CHECK \("documentType" = 'TAX_INVOICE'\)/);
  assert.match(migration, /CHECK \("documentType" = 'ADJUSTMENT_NOTE'\)/);
  assert.match(migration, /CHECK \("sequenceValue" >= 1\)/);
  assert.match(migration, /hospitality_issued_invoices_number_sequence_identity_check/);
  assert.match(migration, /hospitality_issued_adjustment_notes_number_sequence_identity_check/);
  assert.match(migration, /'AU-TAX-' \|\| LPAD/);
  assert.match(migration, /'AU-ADJ-' \|\| LPAD/);
  assert.ok((migration.match(/GREATEST\(8, LENGTH\(/g) ?? []).length >= 4);
});

test('database regression covers direct counter tampering and is registered', () => {
  assert.match(integration, /nextValue: 9n/);
  assert.match(integration, /increment: 2n/);
  assert.match(integration, /jurisdictionCode: 'NZ'/);
  assert.match(integration, /increment: 1n/);
  assert.match(integration, /does not match issued legal-document history/i);
  assert.match(runner, /hospitality-invoice-number-sequence-integrity\.integration\.ts/);
});

test('documentation forbids reset and explains exact sequence-derived document identity', () => {
  assert.match(docs, /legal-document infrastructure, not an editable counter/i);
  assert.match(docs, /numbering to start at `1`, remain contiguous/i);
  assert.match(docs, /document number is derived exactly from its sequence value/i);
  assert.match(docs, /Deleting a sequence while issued documents remain is rejected/i);
  assert.match(docs, /Product workflows do not expose sequence reset or fiscal-number reuse/i);
});
