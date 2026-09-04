import { moneyMinorToMajorString } from '../pricing/money.ts';

export const HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT = 5_000;

export type HospitalityAdjustmentNoteAccountingExportRow = Readonly<{
  documentNumber: string;
  issuedAt: Date;
  bookingId: string;
  sourceTaxInvoiceNumber: string;
  sourceTaxInvoiceIssuedAt: Date;
  currency: string;
  adjustmentReason: string;
  decreaseSubtotalMinor: bigint;
  decreaseGstMinor: bigint;
  decreaseTotalMinor: bigint;
}>;

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function isoDate(value: Date, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError(`${label} is invalid.`);
  return value.toISOString();
}

export function createHospitalityAdjustmentNoteAccountingCsv(rows: readonly HospitalityAdjustmentNoteAccountingExportRow[]) {
  if (rows.length > HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT) {
    throw new RangeError(`Accounting export cannot exceed ${HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT} adjustment notes.`);
  }

  const header = [
    'document_number',
    'issued_at',
    'booking_id',
    'source_tax_invoice_number',
    'source_tax_invoice_issued_at',
    'currency',
    'adjustment_reason',
    'decrease_ex_gst',
    'gst_decrease',
    'total_decrease_inc_gst',
  ];
  const lines = [header.map(csvCell).join(',')];

  for (const row of rows) {
    const values = [
      row.documentNumber,
      isoDate(row.issuedAt, 'Adjustment-note issue time'),
      row.bookingId,
      row.sourceTaxInvoiceNumber,
      isoDate(row.sourceTaxInvoiceIssuedAt, 'Source tax-invoice issue time'),
      row.currency,
      row.adjustmentReason,
      moneyMinorToMajorString(row.decreaseSubtotalMinor, row.currency),
      moneyMinorToMajorString(row.decreaseGstMinor, row.currency),
      moneyMinorToMajorString(row.decreaseTotalMinor, row.currency),
    ];
    lines.push(values.map(csvCell).join(','));
  }

  return `${lines.join('\r\n')}\r\n`;
}
