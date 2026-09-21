import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const migration = read('prisma/migrations/20260922022600-invoice-foundation-evidence-immutability/migration.sql');
const integration = read('src/server/payments/hospitality-invoice-preparation.integration.ts');
const foundationDocs = read('docs/invoice-foundation.md');

test('issuer profile versions reject in-place rewrites', () => {
  assert.match(migration, /sf_guard_invoice_issuer_profile_update/);
  assert.match(migration, /invoice issuer profile is immutable/);
  assert.match(migration, /BEFORE UPDATE ON "invoice_issuer_profiles"/);
});

test('hospitality invoice preparations reject in-place rewrites', () => {
  assert.match(migration, /sf_guard_hospitality_invoice_preparation_update/);
  assert.match(migration, /hospitality invoice preparation is immutable/);
  assert.match(migration, /BEFORE UPDATE ON "hospitality_invoice_preparations"/);
});

test('guarded PostgreSQL scenario proves both immutable source-evidence rows and create-new behavior', () => {
  assert.match(integration, /invoiceIssuerProfile\.update\(\{/);
  assert.match(integration, /invoice issuer profile is immutable/i);
  assert.match(integration, /hospitalityInvoicePreparation\.update\(\{/);
  assert.match(integration, /hospitality invoice preparation is immutable/i);
  assert.match(integration, /issuerA2\.version, 2/);
  assert.match(integration, /assert\.notEqual\(preparation2\.id, preparation1\.id\)/);
});

test('documentation requires new issuer and preparation rows instead of mutation', () => {
  assert.match(foundationDocs, /PostgreSQL also rejects every in-place `UPDATE` of `InvoiceIssuerProfile` and `HospitalityInvoicePreparation`/);
  assert.match(foundationDocs, /Issuer configuration changes create a new profile version/i);
  assert.match(foundationDocs, /preparation changes create a new frozen snapshot/i);
});
