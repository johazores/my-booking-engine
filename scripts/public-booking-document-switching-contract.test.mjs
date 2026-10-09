import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../app/book/[organization-slug]/', import.meta.url);
const capability = await readFile(new URL('public-booking-document-capability.ts', root), 'utf8');
const receipt = await readFile(new URL('public-booking-receipt.tsx', root), 'utf8');
const documents = await readFile(new URL('public-booking-tax-invoices.tsx', root), 'utf8');

test('capability changes notify both mounted customer document views', () => {
  assert.match(capability, /useSyncExternalStore/);
  assert.match(capability, /window\.dispatchEvent\(new Event\(DOCUMENT_CAPABILITY_CHANGE\)\)/);
  assert.match(capability, /window\.addEventListener\(DOCUMENT_CAPABILITY_CHANGE, onChange\)/);
  assert.match(receipt, /usePublicBookingDocumentCapability\(organizationSlug\)/);
  assert.match(documents, /usePublicBookingDocumentCapability\(organizationSlug\)/);
});

test('receipt and legal document state never renders under a different capability', () => {
  assert.match(receipt, /receiptState\?\.capability === bookingCapability/);
  assert.match(receipt, /errorState\?\.capability === bookingCapability/);
  assert.match(receipt, /generation === requestGeneration\.current/);
  assert.match(documents, /historyState\?\.capability === bookingCapability/);
  assert.match(documents, /errorState\?\.capability === bookingCapability/);
  assert.match(documents, /generation === loadGeneration\.current/);
});

test('stale PDF responses cannot create a customer download', () => {
  assert.match(documents, /generation === downloadGeneration\.current/);
  assert.match(documents, /const blob = await response\.blob\(\);\s*if \(!isCurrent\(\)\) return;/);
  assert.match(documents, /if \(isCurrent\(\)\) anchor\.click\(\)/);
});

test('malformed public legal documents cannot enter the customer render state', () => {
  assert.match(documents, /function isInvoiceHistory\(value: unknown\): value is InvoiceHistory/);
  assert.match(documents, /value\.items\.every\(isTaxInvoice\)/);
  assert.match(documents, /notes\.items\.every\(isAdjustmentNote\)/);
  assert.match(documents, /if \(!isInvoiceHistory\(data\)\) throw new Error/);
});

test('PDF downloads reject incorrect media type and invalid PDF signatures', () => {
  assert.match(documents, /response\.headers\.get\('content-type'\)/);
  assert.match(documents, /'application\/pdf'/);
  assert.match(documents, /blob\.slice\(0, 5\)\.text\(\) !== '%PDF-'/);
});
