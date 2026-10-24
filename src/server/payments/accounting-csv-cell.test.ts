import assert from 'node:assert/strict';
import test from 'node:test';
import { accountingCsvCell } from './accounting-csv-cell.ts';

test('quotes normal accounting values without changing exact money or identifiers', () => {
  assert.equal(accountingCsvCell('118.25'), '"118.25"');
  assert.equal(accountingCsvCell('AU-TAX-00000001'), '"AU-TAX-00000001"');
  assert.equal(accountingCsvCell('Guest, "request"'), '"Guest, ""request"""');
});

test('neutralizes spreadsheet formula prefixes, including after whitespace', () => {
  for (const value of ['=1+1', '+SUM(1,2)', '-2+3', '@SUM(1,2)', '  =HYPERLINK("url")', '\t=1+1', '\r\n@SUM(1)', '\uFEFF=1+1', '\u200B=1+1']) {
    assert.equal(accountingCsvCell(value), `"'${value.replaceAll('"', '""')}"`);
  }
});

test('preserves literal apostrophes and non-formula text', () => {
  assert.equal(accountingCsvCell("'=1+1"), '"\'=1+1"');
  assert.equal(accountingCsvCell('Booking cancellation'), '"Booking cancellation"');
  assert.equal(accountingCsvCell('0.00'), '"0.00"');
});
