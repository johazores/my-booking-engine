import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const helper = read('src/server/payments/hospitality-legal-document-clock.ts');
const writerPaths = [
  'src/server/payments/hospitality-invoice-issuance-service.ts',
  'src/server/payments/hospitality-adjustment-note-service.ts',
  'src/server/payments/hospitality-cancellation-after-amendment-adjustment-note-service.ts',
  'src/server/payments/hospitality-commercial-amendment-adjustment-note-service.ts',
  'src/server/payments/hospitality-commercial-amendment-increasing-adjustment-note-service.ts',
  'src/server/payments/hospitality-repeated-commercial-amendment-adjustment-note-service.ts',
  'src/server/payments/hospitality-repeated-commercial-amendment-increasing-adjustment-note-service.ts',
];
const writers = writerPaths.map((path) => [path, read(path)]);
const timeGuide = read('docs/hospitality-legal-document-time-integrity.md');
const clockGuide = read('docs/hospitality-legal-document-database-clock.md');

test('legal-document issue time is PostgreSQL wall clock normalized to canonical milliseconds', () => {
  assert.match(helper, /transaction\.\$queryRaw<Array<\{ issuedAt: Date \}>>/);
  assert.match(helper, /SELECT date_trunc\('milliseconds', clock_timestamp\(\)\) AS "issuedAt"/);
  assert.match(helper, /issuedAt instanceof Date/);
  assert.match(helper, /Number\.isFinite\(issuedAt\.getTime\(\)\)/);
  assert.match(helper, /HospitalityLegalDocumentClockUnavailableError/);
  assert.doesNotMatch(helper, /new Date\(/);
});

test('all seven Australian legal-document writers use the shared database clock in serializable issuance', () => {
  assert.equal(writers.length, 7);
  for (const [path, source] of writers) {
    assert.match(source, /readHospitalityLegalDocumentIssueTime/);
    assert.match(
      source,
      /const issuedAt = await readHospitalityLegalDocumentIssueTime\(transaction\);/,
      `${path} must use the shared database issue-time authority`,
    );
    assert.doesNotMatch(
      source,
      /const issuedAt = new Date\(\);/,
      `${path} must not use application-node issue time`,
    );
    assert.match(source, /isolationLevel: 'Serializable'/, `${path} must retain serializable issuance`);
  }
});

test('database-clock documentation matches the complete writer boundary', () => {
  assert.match(timeGuide, /All seven current Australian hospitality legal-document writers use the shared/);
  assert.match(timeGuide, /date_trunc\('milliseconds', clock_timestamp\(\)\)/);
  assert.doesNotMatch(timeGuide, /Adjustment-note writers still use their existing application-observed issue time/);
  assert.match(clockGuide, /No legal-document writer falls back to the application-node clock/);
  assert.match(clockGuide, /All seven preserve their existing tenant authorization/);
});

test('legal-document database-clock hardening remains independent from GitHub Actions', () => {
  const combined = [helper, ...writers.map(([, source]) => source), timeGuide, clockGuide].join('\n');
  assert.doesNotMatch(combined, /\.github\/workflows|actions\/checkout/);
});
