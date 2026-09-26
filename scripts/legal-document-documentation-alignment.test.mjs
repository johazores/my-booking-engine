import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [
  pricingDoc,
  roadmapDoc,
  bookingDoc,
  receiptDoc,
  invoiceFoundation,
  invoicePdf,
  issuanceService,
] = await Promise.all([
  read('docs/pricing.md'),
  read('docs/product-roadmap.md'),
  read('docs/booking-management.md'),
  read('docs/payment-receipts.md'),
  read('docs/invoice-foundation.md'),
  read('docs/invoice-pdf.md'),
  read('src/server/payments/hospitality-invoice-issuance-service.ts'),
]);

test('cross-product docs reflect the implemented narrow Australian legal-document lifecycle', () => {
  assert.match(issuanceService, /export async function issueHospitalityAustralianTaxInvoice/);
  assert.match(invoiceFoundation, /serializable tax-invoice numbering\/issuance/i);
  assert.match(pricingDoc, /Australian legal-document issuance is implemented/i);
  assert.match(roadmapDoc, /narrow Australian legal-document issuer\/tax lifecycle is implemented separately from pricing/i);
  assert.match(bookingDoc, /issued tax invoices and supported adjustment notes are authorized and verified through their dedicated document surfaces/i);
  assert.match(receiptDoc, /payment receipt remains customer-safe settlement evidence/i);
  assert.match(invoicePdf, /first or repeated commercial-amendment increasing adjustment notes/i);
  assert.match(invoicePdf, /Commercial schemas 2 through 5 are accepted only after/i);
});

test('cross-product docs do not retain pre-issuance legal-document claims', () => {
  assert.doesNotMatch(pricingDoc, /jurisdiction-specific legal invoice\/tax issuance remain future work/i);
  assert.doesNotMatch(pricingDoc, /Any future legal document issuer/i);
  assert.doesNotMatch(pricingDoc, /SF does not yet persist all required issuer\/business identity/i);
  assert.doesNotMatch(pricingDoc, /next coherent dependency is a deliberate legal issuer\/jurisdiction configuration and issuance model/i);
  assert.doesNotMatch(roadmapDoc, /Jurisdiction-specific legal issuer\/tax semantics remain a separate invoice dependency/i);
  assert.doesNotMatch(bookingDoc, /Jurisdiction-specific legal invoice issuance is not presented as complete/i);
  assert.doesNotMatch(bookingDoc, /Jurisdiction-specific legal invoice\/tax-document issuance also remains a separate commercial requirement/i);
  assert.doesNotMatch(invoicePdf, /verified first-increasing commercial-amendment adjustment notes/i);
  assert.doesNotMatch(invoicePdf, /Schema-version-4 first-increasing rows are accepted only/i);
});

test('documentation still keeps genuinely open Phase 12 boundaries open', () => {
  assert.match(pricingDoc, /mixed\/partial\/non-standard-GST/i);
  assert.match(pricingDoc, /durable customer re-authentication\/email delivery\/resend/i);
  assert.match(pricingDoc, /universal Unicode-safe deterministic PDFs/i);
  assert.match(invoiceFoundation, /universal Unicode-safe deterministic PDF rendering/i);
  assert.match(invoiceFoundation, /jurisdiction\/legal review/i);
  assert.match(bookingDoc, /production database validation/i);
});
