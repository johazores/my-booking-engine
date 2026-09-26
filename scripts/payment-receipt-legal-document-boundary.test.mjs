import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [receiptDoc, issuanceService, invoiceFoundation] = await Promise.all([
  read('docs/payment-receipts.md'),
  read('src/server/payments/hospitality-invoice-issuance-service.ts'),
  read('docs/invoice-foundation.md'),
]);

test('payment receipt docs reflect implemented Australian legal-document issuance while keeping settlement authority separate', () => {
  assert.match(issuanceService, /export async function issueHospitalityAustralianTaxInvoice/);
  assert.match(invoiceFoundation, /serializable tax-invoice numbering\/issuance/i);
  assert.match(receiptDoc, /serializable fiscal numbering and immutable issuance/i);
  assert.match(receiptDoc, /payment receipt remains customer-safe settlement evidence/i);
  assert.match(receiptDoc, /never borrows legal authority from an issued invoice or adjustment note/i);
});

test('payment receipt docs do not retain the pre-issuance foundation claims', () => {
  assert.doesNotMatch(receiptDoc, /without issuing a regulated document/i);
  assert.doesNotMatch(receiptDoc, /invoice preparation\/readiness is not issuance/i);
  assert.doesNotMatch(receiptDoc, /SF still has no fiscal numbering/i);
  assert.doesNotMatch(receiptDoc, /no fiscal numbering, immutable recipient\/billing snapshot, issued invoice\/credit-note lifecycle/i);
});
