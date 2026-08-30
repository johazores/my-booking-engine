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
    /different PostgreSQL database from DATABASE_URL/,
  );
});

test('rejects the same database when credentials or connection options differ', () => {
  assert.throws(
    () =>
      validateDisposableTestDatabase({
        ...validInput,
        testDatabaseUrl: 'postgresql://test-user:test-pass@LOCALHOST/sf_test?sslmode=require',
        applicationDatabaseUrl:
          'postgres://app-user:app-pass@localhost:5432/sf_test?application_name=sf',
      }),
    /different PostgreSQL database from DATABASE_URL/,
  );
});

test('allows the same PostgreSQL server when the database name is different', () => {
  const testDatabaseUrl = 'postgresql://test-user@localhost/sf_test?sslmode=require';

  assert.equal(
    validateDisposableTestDatabase({
      ...validInput,
      testDatabaseUrl,
      applicationDatabaseUrl: 'postgresql://app-user@localhost:5432/sf_dev',
    }),
    testDatabaseUrl,
  );
});

test('rejects non-PostgreSQL, malformed, and database-less URLs', () => {
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
        testDatabaseUrl: 'not-a-url',
      }),
    /valid PostgreSQL URL/,
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

test('rejects PostgreSQL maintenance and template databases', () => {
  for (const databaseName of ['postgres', 'template0', 'template1']) {
    assert.throws(
      () =>
        validateDisposableTestDatabase({
          ...validInput,
          testDatabaseUrl: `postgresql://localhost/${databaseName}`,
        }),
      /maintenance or template database/,
    );
  }
});

test('fails closed when DATABASE_URL is present but invalid', () => {
  assert.throws(
    () =>
      validateDisposableTestDatabase({
        ...validInput,
        applicationDatabaseUrl: 'not-a-url',
      }),
    /DATABASE_URL must be a valid PostgreSQL URL/,
  );
});
