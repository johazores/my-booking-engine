import { moneyMinorToMajorString } from '../pricing/money.ts';

export const HOSPITALITY_INVOICE_ACCOUNTING_EXPORT_LIMIT = 5_000;

export type HospitalityInvoiceAccountingExportRow = Readonly<{
  documentNumber: string;
  issuedAt: Date;
  bookingId: string;
  currency: string;
  accommodationSubtotalMinor: bigint;
  feeTotalMinor: bigint;
  addonTotalMinor: bigint;
  taxTotalMinor: bigint;
  totalMinor: bigint;
}>;

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function isoDate(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('Invoice issue time is invalid.');
  return value.toISOString();
}

export function createHospitalityInvoiceAccountingCsv(rows: readonly HospitalityInvoiceAccountingExportRow[]) {
  if (rows.length > HOSPITALITY_INVOICE_ACCOUNTING_EXPORT_LIMIT) {
    throw new RangeError(`Accounting export cannot exceed ${HOSPITALITY_INVOICE_ACCOUNTING_EXPORT_LIMIT} tax invoices.`);
  }

  const header = [
    'document_number',
    'issued_at',
    'booking_id',
    'currency',
    'accommodation_subtotal',
    'fee_total',
    'addon_total',
    'gst_total',
    'invoice_total',
  ];
  const lines = [header.map(csvCell).join(',')];

  for (const row of rows) {
    const values = [
      row.documentNumber,
      isoDate(row.issuedAt),
      row.bookingId,
      row.currency,
      moneyMinorToMajorString(row.accommodationSubtotalMinor, row.currency),
      moneyMinorToMajorString(row.feeTotalMinor, row.currency),
      moneyMinorToMajorString(row.addonTotalMinor, row.currency),
      moneyMinorToMajorString(row.taxTotalMinor, row.currency),
      moneyMinorToMajorString(row.totalMinor, row.currency),
    ];
    lines.push(values.map(csvCell).join(','));
  }

  return `${lines.join('\r\n')}\r\n`;
}
