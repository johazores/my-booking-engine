import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../app/book/[organization-slug]/public-booking-tax-invoices.tsx', import.meta.url), 'utf8');
const start = source.indexOf('function isRecord(');
const end = source.indexOf('export function PublicBookingTaxInvoices(', start);
assert.ok(start >= 0 && end > start, 'Expected public document validators');
const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  reportDiagnostics: true,
});
assert.deepEqual(compiled.diagnostics ?? [], []);
const { isTaxInvoice, isAdjustmentNote, isInvoiceHistory } = new Function(
  compiled.outputText + '\nreturn { isTaxInvoice, isAdjustmentNote, isInvoiceHistory };',
)();

const party = { legalName: 'Example Pty Ltd', addressLine1: null, addressLine2: null, city: null, region: null, postalCode: null, countryCode: 'AU' };
const invoice = {
  documentTitle: 'Tax invoice', documentNumber: 'INV-001', issuedAt: '2026-10-08T00:00:00Z',
  currency: 'AUD', seller: party, buyer: party, supplierAbn: '12345678901', buyerAbn: null,
  taxableSaleStatement: 'Taxable supply', lines: [{ description: 'Room', quantity: 1, amountMinor: '10000' }],
  subtotalBeforeGstMinor: '10000', gstMinor: '1000', totalMinor: '11000',
};
const adjustment = {
  documentTitle: 'Adjustment note', documentNumber: 'ADJ-001', issuedAt: '2026-10-08T00:00:00Z',
  sourceTaxInvoiceNumber: 'INV-001', sourceTaxInvoiceIssuedAt: '2026-10-08T00:00:00Z',
  currency: 'AUD', seller: party, buyer: party, supplierAbn: '12345678901',
  adjustmentType: 'Decreasing adjustment', adjustmentReason: 'Booking cancellation',
  priceBeforeAdjustmentMinor: '11000', priceAfterAdjustmentMinor: '0',
  decreaseSubtotalMinor: '10000', decreaseGstMinor: '1000', decreaseTotalMinor: '11000',
  increaseSubtotalMinor: '0', increaseGstMinor: '0', increaseTotalMinor: '0',
};

test('tax invoice rejects malformed nested lines and seller or buyer', () => {
  assert.equal(isTaxInvoice(invoice), true);
  for (const bad of [null, [], {}, { ...invoice, seller: null }, { ...invoice, buyer: null },
    { ...invoice, lines: [{ description: 'Room', quantity: 0, amountMinor: '100' }] },
    { ...invoice, lines: [{ description: 'Room', quantity: 1, amountMinor: '-1' }] },
    { ...invoice, lines: [{ description: 'Room', quantity: 1, amountMinor: 'NaN' }] },
    { ...invoice, currency: 'A$' }, { ...invoice, issuedAt: null },
    { ...invoice, seller: { legalName: 'Missing required address fields' } }]) {
    assert.equal(isTaxInvoice(bad), false);
  }
});

test('adjustment note rejects unknown direction, reason and malformed money', () => {
  assert.equal(isAdjustmentNote(adjustment), true);
  for (const bad of [null, [], {}, { ...adjustment, seller: null },
    { ...adjustment, adjustmentType: 'Unknown' },
    { ...adjustment, adjustmentType: 'Increasing adjustment' },
    { ...adjustment, adjustmentReason: 'Other' },
    { ...adjustment, decreaseTotalMinor: '-1' },
    { ...adjustment, sourceTaxInvoiceIssuedAt: 'not-a-date' }]) {
    assert.equal(isAdjustmentNote(bad), false);
  }
});

test('document history validates all entries and pagination metadata', () => {
  const emptyNotes = { total: 0, truncated: false, items: [] };
  assert.equal(isInvoiceHistory({ total: 1, truncated: false, items: [invoice] }), false);
  assert.equal(isInvoiceHistory({ total: 1, truncated: false, items: [invoice], adjustmentNotes: emptyNotes }), true);
  assert.equal(isInvoiceHistory({ total: 1, truncated: false, items: [invoice], adjustmentNotes: { total: 1, truncated: false, items: [adjustment] } }), true);
  for (const bad of [
    null, [], {},
    { total: -1, truncated: false, items: [], adjustmentNotes: emptyNotes },
    { total: 0, truncated: false, items: [invoice], adjustmentNotes: emptyNotes },
    { total: 1, truncated: false, items: [null], adjustmentNotes: emptyNotes },
    { total: 1, truncated: false, items: 'not-an-array', adjustmentNotes: emptyNotes },
    { total: 1, truncated: false, items: [invoice], adjustmentNotes: { total: 1, truncated: false, items: [null] } },
    { total: 1, truncated: false, items: [invoice], adjustmentNotes: { total: 0, truncated: false, items: [adjustment] } },
    { total: 1, truncated: false, items: [invoice], adjustmentNotes: null },
  ]) assert.equal(isInvoiceHistory(bad), false);
});

test('tax invoice rejects contradictory monetary evidence and impossible calendar dates', () => {
  for (const bad of [
    { ...invoice, subtotalBeforeGstMinor: '9999' },
    { ...invoice, gstMinor: '999' },
    { ...invoice, totalMinor: '10999' },
    { ...invoice, lines: [{ description: 'Room', quantity: 1, amountMinor: '9999' }] },
    { ...invoice, issuedAt: '2026-02-30T00:00:00Z' },
  ]) assert.equal(isTaxInvoice(bad), false);
});

test('adjustment notes reject invalid direction, effects, chronology and arithmetic', () => {
  const increasing = {
    ...adjustment, adjustmentType: 'Increasing adjustment',
    adjustmentReason: 'Commercial booking amendment',
    priceBeforeAdjustmentMinor: '11000', priceAfterAdjustmentMinor: '12100',
    decreaseSubtotalMinor: '0', decreaseGstMinor: '0', decreaseTotalMinor: '0',
    increaseSubtotalMinor: '1000', increaseGstMinor: '100', increaseTotalMinor: '1100',
  };
  assert.equal(isAdjustmentNote(increasing), true);
  for (const bad of [
    { ...adjustment, priceAfterAdjustmentMinor: '1' },
    { ...adjustment, decreaseGstMinor: '999' },
    { ...adjustment, increaseTotalMinor: '1' },
    { ...adjustment, issuedAt: '2026-10-07T00:00:00Z' },
    { ...adjustment, sourceTaxInvoiceIssuedAt: '2026-02-30T00:00:00Z' },
    { ...increasing, increaseGstMinor: '99' },
    { ...increasing, priceAfterAdjustmentMinor: '12101' },
    { ...increasing, decreaseTotalMinor: '1' },
  ]) assert.equal(isAdjustmentNote(bad), false);
});

test('document history requires exact bounded first-page counts, uniqueness and truthful truncation', () => {
  const empty = { total: 0, truncated: false, items: [] };
  const invoices = Array.from({ length: 50 }, (_, index) => ({ ...invoice, documentNumber: `INV-${index + 1}` }));
  const adjustments = Array.from({ length: 50 }, (_, index) => ({ ...adjustment, documentNumber: `ADJ-${index + 1}` }));
  const withNotes = (history) => ({ adjustmentNotes: empty, ...history });
  assert.equal(isInvoiceHistory(empty), false);
  assert.equal(isInvoiceHistory(withNotes(empty)), true);
  assert.equal(isInvoiceHistory(withNotes({ total: 1, truncated: false, items: [invoice] })), true);
  assert.equal(isInvoiceHistory(withNotes({ total: 51, truncated: true, items: invoices })), true);
  assert.equal(isInvoiceHistory(withNotes({ total: 50, truncated: false, items: invoices })), true);
  assert.equal(isInvoiceHistory(withNotes({ total: 2, truncated: false, items: [invoice, invoice] })), false);
  assert.equal(isInvoiceHistory(withNotes({ total: 51, truncated: true, items: [...invoices.slice(0, 49), invoices[0]] })), false);
  assert.equal(isInvoiceHistory(withNotes({ ...empty, adjustmentNotes: { total: 2, truncated: false, items: [adjustment, adjustment] } })), false);
  for (const bad of [
    { total: 1, truncated: true, items: [] },
    { total: 1, truncated: false, items: [] },
    { total: 0, truncated: true, items: [] },
    { total: 51, truncated: true, items: invoices.slice(0, 49) },
    { total: 51, truncated: false, items: invoices },
    { total: 50, truncated: true, items: invoices },
    { total: 51, truncated: true, items: [...invoices, invoice] },
    { ...empty, adjustmentNotes: { total: 1, truncated: true, items: [] } },
    { ...empty, adjustmentNotes: { total: 1, truncated: false, items: [] } },
    { ...empty, adjustmentNotes: { total: 0, truncated: true, items: [] } },
    { ...empty, adjustmentNotes: { total: 51, truncated: true, items: adjustments.slice(0, 49) } },
    { ...empty, adjustmentNotes: { total: 51, truncated: false, items: adjustments } },
    { ...empty, adjustmentNotes: { total: 50, truncated: true, items: adjustments } },
    { ...empty, adjustmentNotes: { total: 51, truncated: true, items: [...adjustments, adjustment] } },
  ]) assert.equal(isInvoiceHistory(withNotes(bad)), false);
  assert.equal(isInvoiceHistory(withNotes({ ...empty, adjustmentNotes: { total: 51, truncated: true, items: adjustments } })), true);
  assert.equal(isInvoiceHistory(withNotes({ ...empty, adjustmentNotes: { total: 50, truncated: false, items: adjustments } })), true);
});
