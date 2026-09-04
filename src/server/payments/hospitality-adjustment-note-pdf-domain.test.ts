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

const commercial = {
  ...base,
  documentNumber: 'AU-ADJ-00000008',
  adjustmentReason: 'Commercial booking amendment' as const,
  priceBeforeAdjustmentMinor: '11000',
  priceAfterAdjustmentMinor: '8800',
  decreaseSubtotalMinor: '2000',
  decreaseGstMinor: '200',
  decreaseTotalMinor: '2200',
};

const increasing = {
  ...base,
  documentNumber: 'AU-ADJ-00000009',
  adjustmentType: 'Increasing adjustment' as const,
  adjustmentReason: 'Commercial booking amendment' as const,
  priceBeforeAdjustmentMinor: '11000',
  priceAfterAdjustmentMinor: '13200',
  decreaseSubtotalMinor: '0',
  decreaseGstMinor: '0',
  decreaseTotalMinor: '0',
  increaseSubtotalMinor: '2000',
  increaseGstMinor: '200',
  increaseTotalMinor: '2200',
};

test('renders byte-for-byte deterministic cancellation adjustment-note PDF with immutable identities', () => {
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

test('renders byte-for-byte deterministic decreasing commercial-amendment adjustment-note PDF', () => {
  const first = createHospitalityAdjustmentNotePdf(commercial);
  const second = createHospitalityAdjustmentNotePdf(structuredClone(commercial));
  assert.deepEqual(first, second);
  assert.equal(first.subarray(0, 8).toString('ascii'), '%PDF-1.4');
  assert.match(first.toString('ascii'), /436F6D6D65726369616C20626F6F6B696E6720616D656E646D656E74/);
  assert.match(first.toString('ascii'), /4155442038382E3030/);
  assert.match(first.toString('ascii'), /4155442032322E3030/);
});

test('renders deterministic increasing commercial-amendment adjustment-note PDF', () => {
  const first = createHospitalityAdjustmentNotePdf(increasing);
  const second = createHospitalityAdjustmentNotePdf(structuredClone(increasing));
  assert.deepEqual(first, second);
  assert.equal(first.subarray(0, 8).toString('ascii'), '%PDF-1.4');
  assert.match(first.toString('ascii'), /496E6372656173696E672061646A7573746D656E74/);
  assert.match(first.toString('ascii'), /496E637265617365206578636C2E20475354/);
  assert.match(first.toString('ascii'), /415544203132302E3030/);
  assert.match(first.toString('ascii'), /4155442032322E3030/);
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

test('rejects inconsistent decreasing commercial-amendment price effects', () => {
  assert.throws(
    () => createHospitalityAdjustmentNotePdf({ ...commercial, priceAfterAdjustmentMinor: '8700' }),
    HospitalityAdjustmentNotePdfValidationError,
  );
  assert.throws(
    () => createHospitalityAdjustmentNotePdf({ ...commercial, priceAfterAdjustmentMinor: '11000' }),
    HospitalityAdjustmentNotePdfValidationError,
  );
});

test('rejects inconsistent or mixed increasing effects', () => {
  assert.throws(
    () => createHospitalityAdjustmentNotePdf({ ...increasing, priceAfterAdjustmentMinor: '13100' }),
    HospitalityAdjustmentNotePdfValidationError,
  );
  assert.throws(
    () => createHospitalityAdjustmentNotePdf({ ...increasing, increaseGstMinor: '100' }),
    HospitalityAdjustmentNotePdfValidationError,
  );
  assert.throws(
    () => createHospitalityAdjustmentNotePdf({ ...increasing, decreaseTotalMinor: '1' }),
    HospitalityAdjustmentNotePdfValidationError,
  );
});

test('rejects non-AUD, unknown reasons, and impossible source-document chronology', () => {
  assert.throws(
    () => createHospitalityAdjustmentNotePdf({ ...base, currency: 'USD' }),
    HospitalityAdjustmentNotePdfValidationError,
  );
  assert.throws(
    () => createHospitalityAdjustmentNotePdf({ ...base, adjustmentReason: 'Manual correction' as never }),
    HospitalityAdjustmentNotePdfValidationError,
  );
  assert.throws(
    () => createHospitalityAdjustmentNotePdf({ ...base, sourceTaxInvoiceIssuedAt: '2026-09-05T00:00:00.000Z' }),
    HospitalityAdjustmentNotePdfValidationError,
  );
});
