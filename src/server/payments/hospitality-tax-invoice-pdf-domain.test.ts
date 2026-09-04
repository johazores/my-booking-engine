import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HospitalityTaxInvoicePdfValidationError,
  createHospitalityTaxInvoicePdf,
} from './hospitality-tax-invoice-pdf-domain.ts';

const base = {
  documentTitle: 'Tax invoice' as const,
  documentNumber: 'AU-TAX-00000042',
  issuedAt: '2026-09-04T02:30:00.000Z',
  currency: 'AUD',
  seller: { legalName: 'SF Hotels Pty Ltd', contactEmail: 'billing@example.com', email: null, addressLine1: '1 Example Street', addressLine2: null, city: 'Sydney', region: 'NSW', postalCode: '2000', countryCode: 'AU' },
  buyer: { legalName: 'Joséphine Example', email: 'guest@example.com', contactEmail: null, addressLine1: '2 Guest Road', addressLine2: null, city: 'Melbourne', region: 'VIC', postalCode: '3000', countryCode: 'AU' },
  supplierAbn: '51824753556',
  buyerAbn: null,
  taxableSaleStatement: 'All supplies shown on this tax invoice are taxable sales.',
  lines: [{ description: 'Accommodation — 2026-09-04', quantity: 1, amountMinor: '10000' }],
  subtotalBeforeGstMinor: '10000',
  gstMinor: '1000',
  totalMinor: '11000',
};

test('renders byte-for-byte deterministic PDF with immutable identity', () => {
  const first = createHospitalityTaxInvoicePdf(base);
  const second = createHospitalityTaxInvoicePdf(structuredClone(base));
  assert.deepEqual(first, second);
  assert.equal(first.subarray(0, 8).toString('ascii'), '%PDF-1.4');
  assert.match(first.toString('binary'), /\/Type \/Catalog/);
  assert.match(first.toString('ascii'), /41552D5441582D3030303030303432/);
  assert.match(first.toString('ascii'), /54617820696E766F696365/);
  assert.doesNotMatch(first.toString('utf8'), /guest@example\.com/);
});

test('paginates large invoices deterministically', () => {
  const document = { ...base, lines: Array.from({ length: 90 }, (_, index) => ({ description: `Accommodation ${index + 1}`, quantity: 1, amountMinor: '100' })), subtotalBeforeGstMinor: '9000', gstMinor: '900', totalMinor: '9900' };
  const pdf = createHospitalityTaxInvoicePdf(document);
  const pageCount = Number(pdf.toString('ascii').match(/\/Type \/Pages \/Count (\d+)/)?.[1]);
  assert.ok(pageCount >= 2);
});

test('fails closed rather than corrupting unsupported legal text', () => {
  assert.throws(
    () => createHospitalityTaxInvoicePdf({ ...base, buyer: { ...base.buyer, legalName: '山田 太郎' } }),
    HospitalityTaxInvoicePdfValidationError,
  );
});

test('rejects inconsistent totals and non-AUD documents', () => {
  assert.throws(() => createHospitalityTaxInvoicePdf({ ...base, totalMinor: '12000' }), HospitalityTaxInvoicePdfValidationError);
  assert.throws(() => createHospitalityTaxInvoicePdf({ ...base, currency: 'USD' }), HospitalityTaxInvoicePdfValidationError);
});
