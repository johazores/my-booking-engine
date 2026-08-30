import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DATABASE_TEST_CONFIRMATION,
  validateDisposableTestDatabase,
} from './database-test-safety.mjs';

const validInput = {
  testDatabaseUrl: 'postgresql://localhost:5432/sf_test',
  applicationDatabaseUrl: 'postgresql://localhost:5432/sf_dev',
  confirmation: DATABASE_TEST_CONFIRMATION,
};

test('accepts an explicitly confirmed separate PostgreSQL test database', () => {
  assert.equal(validateDisposableTestDatabase(validInput), validInput.testDatabaseUrl);
});

test('rejects missing explicit confirmation', () => {
  assert.throws(
    () => validateDisposableTestDatabase({ ...validInput, confirmation: undefined }),
    /SF_DATABASE_TEST_CONFIRM/,
  );
});

test('rejects reuse of the normal application database', () => {
  assert.throws(
    () =>
      validateDisposableTestDatabase({
        ...validInput,
        applicationDatabaseUrl: validInput.testDatabaseUrl,
      }),
    /must be different from DATABASE_URL/,
  );
});

test('rejects non-PostgreSQL and database-less URLs', () => {
  assert.throws(
    () =>
      validateDisposableTestDatabase({
        ...validInput,
        testDatabaseUrl: 'mysql://localhost/sf_test',
      }),
    /must use PostgreSQL/,
  );
  assert.throws(
    () =>
      validateDisposableTestDatabase({
        ...validInput,
        testDatabaseUrl: 'postgresql://localhost/',
      }),
    /database name/,
  );
});
