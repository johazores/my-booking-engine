import assert from 'node:assert/strict';
import test from 'node:test';
import { DATABASE_TEST_CONFIRMATION, validateDisposableTestDatabase } from './database-test-safety.mjs';

const baseline = {
  testDatabaseUrl: 'postgresql://localhost/sf_test',
  applicationDatabaseUrl: 'postgresql://localhost/sf_dev',
  confirmation: DATABASE_TEST_CONFIRMATION,
};

test('common IPv4 localhost aliases cannot bypass test/app database separation in either direction', () => {
  for (const alias of ['localhost4', 'localhost4.localdomain4', 'LOCALHOST4.', 'LOCALHOST4.LOCALDOMAIN4.']) {
    for (const reversed of [false, true]) {
      assert.throws(() => validateDisposableTestDatabase({
        ...baseline,
        testDatabaseUrl: `postgresql://${reversed ? 'localhost' : alias}/sf_test`,
        applicationDatabaseUrl: `postgresql://${reversed ? alias : 'localhost'}/sf_test`,
      }), /different PostgreSQL database/, alias);
    }
  }
});

test('rejects control bytes, path separators, and oversized UTF-8 database names on both sides', () => {
  for (const databaseName of ['sf%00test', 'sf%0Atest', 'sf%2Ftest', 'sf%5Ctest', '/sf_test', 'a'.repeat(64), 'é'.repeat(32)]) {
    for (const variable of ['testDatabaseUrl', 'applicationDatabaseUrl']) {
      assert.throws(() => validateDisposableTestDatabase({
        ...baseline,
        [variable]: `postgresql://localhost/${databaseName}`,
      }), /valid PostgreSQL database name within 63 UTF-8 bytes/, `${variable}: ${databaseName}`);
    }
  }
});

test('allows distinct valid 63-byte and Unicode database identifiers', () => {
  const testDatabaseUrl = `postgresql://localhost/${'a'.repeat(63)}`;
  assert.equal(validateDisposableTestDatabase({ ...baseline, testDatabaseUrl }), testDatabaseUrl);
  const unicodeUrl = `postgresql://localhost/${'é'.repeat(31)}`;
  assert.equal(validateDisposableTestDatabase({ ...baseline, testDatabaseUrl: unicodeUrl }), unicodeUrl);
});

test('rejects ambiguous slash-path aliases instead of silently stripping path separators', () => {
  for (const slashPath of ['//sf_test', '///sf_test', '/%2Fsf_test', '/%2F%2Fsf_test']) {
    assert.throws(() => validateDisposableTestDatabase({
      ...baseline,
      testDatabaseUrl: `postgresql://localhost${slashPath}`,
      applicationDatabaseUrl: 'postgresql://localhost/sf_test',
    }), /valid PostgreSQL database name within 63 UTF-8 bytes/, slashPath);
  }
});
