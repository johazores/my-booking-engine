import { moneyMinorToMajorString } from '../pricing/money.ts';

export const HOSPITALITY_ADJUSTMENT_NOTE_ACCOUNTING_EXPORT_LIMIT = 5_000;

type HospitalityAdjustmentNoteAccountingBaseRow = Readonly<{
  documentNumber: string;
  issuedAt: Date;
  bookingId: string;
  sourceTaxInvoiceNumber: string;
  sourceTaxInvoiceIssuedAt: Date;
  currency: string;
  adjustmentReason: string;
}>;

type HospitalityDecreasingAdjustmentNoteAccountingRow = HospitalityAdjustmentNoteAccountingBaseRow & Readonly<{
  adjustmentType?: 'Decreasing adjustment';
  decreaseSubtotalMinor: bigint;
  decreaseGstMinor: bigint;
  decreaseTotalMinor: bigint;
  increaseSubtotalMinor?: 0n;
  increaseGstMinor?: 0n;
  increaseTotalMinor?: 0n;
}>;

type HospitalityIncreasingAdjustmentNoteAccountingRow = HospitalityAdjustmentNoteAccountingBaseRow & Readonly<{
  adjustmentType: 'Increasing adjustment';
  decreaseSubtotalMinor: 0n;
  decreaseGstMinor: 0n;
  decreaseTotalMinor: 0n;
  increaseSubtotalMinor: bigint;
  increaseGstMinor: bigint;
  increaseTotalMinor: bigint;
}>;

export type HospitalityAdjustmentNoteAccountingExportRow =
  | HospitalityDecreasingAdjustmentNoteAccountingRow
  | HospitalityIncreasingAdjustmentNoteAccountingRow;

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function isoDate(value: Date, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError(`${label} is invalid.`);
  return value.toISOString();
}

function nonNegative(value: bigint, label: string) {
  if (typeof value !== 'bigint' || value < 0n) throw new TypeError(`${label} must be a non-negative bigint.`);
  return value;
}

function normalizedEffect(row: HospitalityAdjustmentNoteAccountingExportRow) {
  const adjustmentType = row.adjustmentType ?? 'Decreasing adjustment';
  const decreaseSubtotalMinor = nonNegative(row.decreaseSubtotalMinor, 'decreaseSubtotalMinor');
  const decreaseGstMinor = nonNegative(row.decreaseGstMinor, 'decreaseGstMinor');
  const decreaseTotalMinor = nonNegative(row.decreaseTotalMinor, 'decreaseTotalMinor');
  const increaseSubtotalMinor = nonNegative(row.increaseSubtotalMinor ?? 0n, 'increaseSubtotalMinor');
  const increaseGstMinor = nonNegative(row.increaseGstMinor ?? 0n, 'increaseGstMinor');
  const increaseTotalMinor = nonNegative(row.increaseTotalMinor ?? 0n, 'increaseTotalMinor');

  if (adjustmentType === 'Decreasing adjustment') {
    if (
      decreaseTotalMinor <= 0n
      || decreaseSubtotalMinor + decreaseGstMinor !== decreaseTotalMinor
      || increaseSubtotalMinor !== 0n
      || increaseGstMinor !== 0n
      || increaseTotalMinor !== 0n
    ) {
      throw new TypeError('Decreasing adjustment accounting effect is inconsistent.');
    }
  } else if (
    increaseTotalMinor <= 0n
    || increaseSubtotalMinor + increaseGstMinor !== increaseTotalMinor
    || decreaseSubtotalMinor !== 0n
    || decreaseGstMinor !== 0n
    || decreaseTotalMinor !== 0n
  ) {
    throw new TypeError('Increasing adjustment accounting effect is inconsistent.');
  }

  return Object.freeze({
    adjustmentType,
    decreaseSubtotalMinor,
    decreaseGstMinor,
    decreaseTotalMinor,
    increaseSubtotalMinor,
    increaseGstMinor,
    increaseTotalMinor,
  });
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
    'adjustment_type',
    'decrease_ex_gst',
    'gst_decrease',
    'total_decrease_inc_gst',
    'increase_ex_gst',
    'gst_increase',
    'total_increase_inc_gst',
  ];
  const lines = [header.map(csvCell).join(',')];

  for (const row of rows) {
    const effect = normalizedEffect(row);
    const values = [
      row.documentNumber,
      isoDate(row.issuedAt, 'Adjustment-note issue time'),
      row.bookingId,
      row.sourceTaxInvoiceNumber,
      isoDate(row.sourceTaxInvoiceIssuedAt, 'Source tax-invoice issue time'),
      row.currency,
      row.adjustmentReason,
      effect.adjustmentType,
      moneyMinorToMajorString(effect.decreaseSubtotalMinor, row.currency),
      moneyMinorToMajorString(effect.decreaseGstMinor, row.currency),
      moneyMinorToMajorString(effect.decreaseTotalMinor, row.currency),
      moneyMinorToMajorString(effect.increaseSubtotalMinor, row.currency),
      moneyMinorToMajorString(effect.increaseGstMinor, row.currency),
      moneyMinorToMajorString(effect.increaseTotalMinor, row.currency),
    ];
    lines.push(values.map(csvCell).join(','));
  }

  return `${lines.join('\r\n')}\r\n`;
}
