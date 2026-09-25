import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HospitalityLegalDocumentClockUnavailableError,
  readHospitalityLegalDocumentIssueTime,
} from './hospitality-legal-document-clock.ts';

function createTransaction(result: unknown) {
  let query = '';
  return {
    transaction: {
      async $queryRaw(strings: TemplateStringsArray) {
        query = strings.join('');
        return result;
      },
    },
    readQuery: () => query,
  };
}

test('returns the exact PostgreSQL-observed millisecond issue time', async () => {
  const issuedAt = new Date('2026-09-25T12:34:56.789Z');
  const fake = createTransaction([{ issuedAt }]);

  const actual = await readHospitalityLegalDocumentIssueTime(fake.transaction as never);

  assert.equal(actual, issuedAt);
  assert.match(
    fake.readQuery(),
    /date_trunc\('milliseconds', clock_timestamp\(\)\) AS "issuedAt"/,
  );
});

test('fails closed when PostgreSQL does not return a valid Date', async () => {
  for (const result of [
    [],
    [{}],
    [{ issuedAt: '2026-09-25T12:34:56.789Z' }],
    [{ issuedAt: new Date(Number.NaN) }],
  ]) {
    const fake = createTransaction(result);
    await assert.rejects(
      () => readHospitalityLegalDocumentIssueTime(fake.transaction as never),
      HospitalityLegalDocumentClockUnavailableError,
    );
  }
});
