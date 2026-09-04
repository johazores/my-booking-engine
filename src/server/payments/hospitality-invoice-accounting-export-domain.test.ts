import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSPITALITY_INVOICE_ACCOUNTING_EXPORT_LIMIT,
  createHospitalityInvoiceAccountingCsv,
} from './hospitality-invoice-accounting-export-domain.ts';

test('creates exact quoted CRLF accounting CSV from immutable invoice money', () => {
  const csv = createHospitalityInvoiceAccountingCsv([{
    documentNumber: 'AU-TAX-00000001',
    issuedAt: new Date('2026-09-04T03:00:00.000Z'),
    bookingId: '11111111-1111-4111-8111-111111111111',
    currency: 'AUD',
    accommodationSubtotalMinor: 10_000n,
    feeTotalMinor: 500n,
    addonTotalMinor: 250n,
    taxTotalMinor: 1_075n,
    totalMinor: 11_825n,
  }]);

  assert.match(csv, /^"document_number","issued_at","booking_id","currency"/);
  assert.match(csv, /"100\.00","5\.00","2\.50","10\.75","118\.25"\r\n$/);
  assert.ok(csv.includes('"2026-09-04T03:00:00.000Z"'));
});

test('emits a stable header-only export for empty history', () => {
  const csv = createHospitalityInvoiceAccountingCsv([]);
  assert.equal(csv.split('\r\n').filter(Boolean).length, 1);
});

test('rejects unbounded exports and invalid dates', () => {
  const row = {
    documentNumber: 'AU-TAX-00000001',
    issuedAt: new Date('2026-09-04T03:00:00.000Z'),
    bookingId: '11111111-1111-4111-8111-111111111111',
    currency: 'AUD',
    accommodationSubtotalMinor: 0n,
    feeTotalMinor: 0n,
    addonTotalMinor: 0n,
    taxTotalMinor: 0n,
    totalMinor: 0n,
  };

  assert.throws(
    () => createHospitalityInvoiceAccountingCsv(Array.from({ length: HOSPITALITY_INVOICE_ACCOUNTING_EXPORT_LIMIT + 1 }, () => row)),
    RangeError,
  );
  assert.throws(
    () => createHospitalityInvoiceAccountingCsv([{ ...row, issuedAt: new Date(Number.NaN) }]),
    TypeError,
  );
});
