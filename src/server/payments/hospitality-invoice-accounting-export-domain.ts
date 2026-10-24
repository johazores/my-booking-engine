import { moneyMinorToMajorString } from '../pricing/money.ts';
import { accountingCsvCell } from './accounting-csv-cell.ts';

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

function isoDate(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('Invoice issue time is invalid.');
  return value.toISOString();
}

function validateInvoiceMoney(row: HospitalityInvoiceAccountingExportRow) {
  const components = [
    ['accommodationSubtotalMinor', row.accommodationSubtotalMinor],
    ['feeTotalMinor', row.feeTotalMinor],
    ['addonTotalMinor', row.addonTotalMinor],
    ['taxTotalMinor', row.taxTotalMinor],
    ['totalMinor', row.totalMinor],
  ] as const;
  for (const [label, amount] of components) {
    if (typeof amount !== 'bigint' || amount < 0n) {
      throw new TypeError(`${label} must be a non-negative bigint.`);
    }
  }
  if (row.accommodationSubtotalMinor + row.feeTotalMinor + row.addonTotalMinor + row.taxTotalMinor !== row.totalMinor) {
    throw new TypeError('Invoice accounting total does not match its components.');
  }
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
  const lines = [header.map(accountingCsvCell).join(',')];

  for (const row of rows) {
    validateInvoiceMoney(row);
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
    lines.push(values.map(accountingCsvCell).join(','));
  }

  return `${lines.join('\r\n')}\r\n`;
}
