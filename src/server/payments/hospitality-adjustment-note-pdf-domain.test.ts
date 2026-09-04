import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HospitalityAdjustmentNotePdfValidationError,
  createHospitalityAdjustmentNotePdf,
} from './hospitality-adjustment-note-pdf-domain.ts';

const base = {
  documentTitle: 'Adjustment note' as const,
  documentNumber: 'AU-ADJ-00000007',
  issuedAt: '2026-09-04T05:00:00.000Z',
  currency: 'AUD',
  sourceTaxInvoiceNumber: 'AU-TAX-00000042',
  sourceTaxInvoiceIssuedAt: '2026-09-03T02:30:00.000Z',
  seller: { legalName: 'SF Hotels Pty Ltd', contactEmail: 'billing@example.com', email: null, addressLine1: '1 Example Street', addressLine2: null, city: 'Sydney', region: 'NSW', postalCode: '2000', countryCode: 'AU' },
  buyer: { legalName: 'Joséphine Example', email: 'guest@example.com', contactEmail: null, addressLine1: '2 Guest Road', addressLine2: null, city: 'Melbourne', region: 'VIC', postalCode: '3000', countryCode: 'AU' },
  supplierAbn: '51824753556',
  adjustmentType: 'Decreasing adjustment' as const,
  adjustmentReason: 'Booking cancellation' as const,
  priceBeforeAdjustmentMinor: '11000',
  priceAfterAdjustmentMinor: '0',
  decreaseSubtotalMinor: '10000',
  decreaseGstMinor: '1000',
  decreaseTotalMinor: '11000',
};

test('renders byte-for-byte deterministic adjustment-note PDF with immutable identities', () => {
  const first = createHospitalityAdjustmentNotePdf(base);
  const second = createHospitalityAdjustmentNotePdf(structuredClone(base));
  assert.deepEqual(first, second);
  assert.equal(first.subarray(0, 8).toString('ascii'), '%PDF-1.4');
  assert.match(first.toString('binary'), /\/Type \/Catalog/);
  assert.match(first.toString('ascii'), /41552D41444A2D3030303030303037/);
  assert.match(first.toString('ascii'), /41552D5441582D3030303030303432/);
  assert.match(first.toString('ascii'), /41646A7573746D656E74206E6F7465/);
  assert.doesNotMatch(first.toString('utf8'), /guest@example\.com/);
});

test('fails closed rather than corrupting unsupported legal text', () => {
  assert.throws(
    () => createHospitalityAdjustmentNotePdf({ ...base, buyer: { ...base.buyer, legalName: '山田 太郎' } }),
    HospitalityAdjustmentNotePdfValidationError,
  );
});

test('rejects inconsistent cancellation price effects and totals', () => {
  assert.throws(
    () => createHospitalityAdjustmentNotePdf({ ...base, priceBeforeAdjustmentMinor: '12000' }),
    HospitalityAdjustmentNotePdfValidationError,
  );
  assert.throws(
    () => createHospitalityAdjustmentNotePdf({ ...base, decreaseGstMinor: '900' }),
    HospitalityAdjustmentNotePdfValidationError,
  );
});

test('rejects non-AUD and impossible source-document chronology', () => {
  assert.throws(
    () => createHospitalityAdjustmentNotePdf({ ...base, currency: 'USD' }),
    HospitalityAdjustmentNotePdfValidationError,
  );
  assert.throws(
    () => createHospitalityAdjustmentNotePdf({ ...base, sourceTaxInvoiceIssuedAt: '2026-09-05T00:00:00.000Z' }),
    HospitalityAdjustmentNotePdfValidationError,
  );
});
