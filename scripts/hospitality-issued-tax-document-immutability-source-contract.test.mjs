import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const migration = read('prisma/migrations/20260922022500-hospitality-issued-tax-document-immutability/migration.sql');
const integration = read('src/server/payments/hospitality-invoice-issuance.integration.ts');
const retentionDocs = read('docs/tax-document-retention-and-reconciliation.md');
const issuanceDocs = read('docs/invoice-issuance.md');

test('issued hospitality tax invoices reject in-place rewrites', () => {
  assert.match(migration, /sf_guard_hospitality_issued_invoice_update/);
  assert.match(migration, /hospitality issued tax invoice is immutable/);
  assert.match(migration, /BEFORE UPDATE ON "hospitality_issued_invoices"/);
});

test('issued hospitality adjustment notes reject in-place rewrites', () => {
  assert.match(migration, /sf_guard_hospitality_issued_adjustment_note_update/);
  assert.match(migration, /hospitality issued adjustment note is immutable/);
  assert.match(migration, /BEFORE UPDATE ON "hospitality_issued_adjustment_notes"/);
});

test('issued legal documents cannot be deleted while their tenant booking is retained', () => {
  assert.match(migration, /sf_guard_hospitality_issued_invoice_deletion/);
  assert.match(migration, /sf_guard_hospitality_issued_adjustment_note_deletion/);
  assert.match(migration, /booking\."organizationId" = OLD\."organizationId"/);
  assert.match(migration, /booking\."id" = OLD\."bookingId"/);
  assert.match(migration, /hospitality issued tax invoice cannot be deleted while the booking is retained/);
  assert.match(migration, /hospitality issued adjustment note cannot be deleted while the booking is retained/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER hospitality_issued_invoice_deletion_guard/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER hospitality_issued_adjustment_note_deletion_guard/);
  assert.equal((migration.match(/DEFERRABLE INITIALLY DEFERRED/g) ?? []).length, 2);
});

test('invoice database scenario proves mutation guards and uses coherent legal-evidence teardown', () => {
  assert.match(integration, /hospitalityIssuedInvoice\.update\(\{/);
  assert.match(integration, /hospitality issued tax invoice is immutable/i);
  assert.match(integration, /hospitalityIssuedInvoice\.delete\(\{ where: \{ id: issued1a\.id \} \}\)/);
  assert.match(integration, /cannot be deleted while the booking is retained/i);
  assert.match(integration, /db\.\$transaction\(async \(transaction\) => \{/);
  assert.match(integration, /transaction\.hospitalityIssuedAdjustmentNote\.deleteMany/);
  assert.match(integration, /transaction\.hospitalityIssuedInvoice\.deleteMany/);
  assert.match(integration, /transaction\.hospitalityInvoicePreparation\.deleteMany/);
  assert.match(integration, /transaction\.hospitalityBookingPricingEvidence\.deleteMany/);
  assert.match(integration, /transaction\.hospitalityBooking\.deleteMany/);
});

test('documentation states the database-enforced legal-document retention contract', () => {
  assert.match(retentionDocs, /PostgreSQL independently enforces that retention boundary/i);
  assert.match(retentionDocs, /Every in-place `UPDATE` of an issued tax invoice or adjustment note is rejected/i);
  assert.match(retentionDocs, /standalone deletion is rejected while the owning tenant booking remains retained/i);
  assert.match(issuanceDocs, /rejects every in-place update of an issued tax invoice or adjustment note/i);
  assert.match(issuanceDocs, /Coherent same-transaction teardown/i);
});
