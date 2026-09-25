import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const helper = readFileSync(
  new URL('../src/server/payments/hospitality-legal-document-clock.ts', import.meta.url),
  'utf8',
);
const invoiceWriter = readFileSync(
  new URL('../src/server/payments/hospitality-invoice-issuance-service.ts', import.meta.url),
  'utf8',
);
const timeGuide = readFileSync(
  new URL('../docs/hospitality-legal-document-time-integrity.md', import.meta.url),
  'utf8',
);
const clockGuide = readFileSync(
  new URL('../docs/hospitality-tax-invoice-database-clock.md', import.meta.url),
  'utf8',
);

test('tax-invoice issue time is read from PostgreSQL and fails closed', () => {
  assert.match(helper, /transaction\.\$queryRaw<Array<\{ issuedAt: Date \}>>/);
  assert.match(helper, /SELECT clock_timestamp\(\) AS "issuedAt"/);
  assert.match(helper, /issuedAt instanceof Date/);
  assert.match(helper, /Number\.isFinite\(issuedAt\.getTime\(\)\)/);
  assert.match(helper, /HospitalityLegalDocumentClockUnavailableError/);
  assert.doesNotMatch(helper, /new Date\(/);
});

test('tax-invoice writer uses the shared database clock inside issuance transaction', () => {
  assert.match(invoiceWriter, /readHospitalityLegalDocumentIssueTime/);
  assert.match(invoiceWriter, /const issuedAt = await readHospitalityLegalDocumentIssueTime\(transaction\);/);
  assert.doesNotMatch(invoiceWriter, /const issuedAt = new Date\(\);/);
  assert.match(invoiceWriter, /documentSnapshot: toJsonInput\(snapshot\)/);
  assert.match(invoiceWriter, /isolationLevel: 'Serializable'/);
});

test('documentation does not overclaim adjustment-note clock authority', () => {
  assert.match(timeGuide, /Tax-invoice issuance now reads PostgreSQL `clock_timestamp\(\)`/);
  assert.match(timeGuide, /Adjustment-note writers still use their existing application-observed issue time/);
  assert.match(clockGuide, /moves the tax-invoice writer first/i);
  assert.match(clockGuide, /not claimed as database-clock-authored yet/i);
});

test('database-clock hardening remains independent from GitHub Actions', () => {
  const combined = [helper, invoiceWriter, timeGuide, clockGuide].join('\n');
  assert.doesNotMatch(combined, /\.github\/workflows|github actions/i);
});
