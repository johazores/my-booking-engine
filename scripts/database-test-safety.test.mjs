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

test('rejects reuse of a local database through common hostname aliases', () => {
  for (const host of ['127.0.0.1', '127.1', '[::1]', '[::ffff:127.0.0.1]', '[::ffff:127.0.0.2]', 'localhost.', 'localhost.localdomain', '0.0.0.0', '[::]', '[::ffff:0:0]', '[::ffff:0.0.0.0]']) {
    assert.throws(
      () => validateDisposableTestDatabase({
        ...validInput,
        testDatabaseUrl: 'postgresql://test-user@' + host + ':5432/sf_test',
        applicationDatabaseUrl: 'postgres://app-user@localhost/sf_test',
      }),
      /different PostgreSQL database from DATABASE_URL/,
      'must reject local alias ' + host,
    );
  }
});

test('rejects unspecified IPv6 aliases in application targets too', () => {
  for (const host of ['[::]', '[::ffff:0:0]', '[::ffff:0.0.0.0]']) {
    assert.throws(
      () => validateDisposableTestDatabase({
        ...validInput,
        testDatabaseUrl: 'postgresql://localhost/sf_test',
        applicationDatabaseUrl: `postgresql://${host}/sf_test`,
      }),
      /different PostgreSQL database from DATABASE_URL/,
      `must reject application alias ${host}`,
    );
  }
});

test('rejects target-changing URL query parameters on either connection', () => {
  for (const parameter of ['host', 'hostaddr', 'port', 'database', 'dbname', 'service']) {
    for (const variable of ['testDatabaseUrl', 'applicationDatabaseUrl']) {
      assert.throws(
        () => validateDisposableTestDatabase({
          ...validInput,
          [variable]: 'postgresql://localhost/sf_test?' + parameter + '=production',
        }),
        /must not override PostgreSQL host, port, database, or service/,
        'must reject ' + parameter + ' in ' + variable,
      );
    }
  }
});

test('rejects implicit local socket targets and invalid encoded database names', () => {
  for (const variable of ['testDatabaseUrl', 'applicationDatabaseUrl']) {
    assert.throws(
      () => validateDisposableTestDatabase({ ...validInput, [variable]: 'postgresql:///sf_test' }),
      /explicit PostgreSQL hostname/,
    );
    assert.throws(
      () => validateDisposableTestDatabase({ ...validInput, [variable]: 'postgresql://localhost/sf_test%E0%A4%A' }),
      /valid encoded PostgreSQL database name/,
    );
  }
});

test('still permits different databases through loopback aliases', () => {
  const testDatabaseUrl = 'postgresql://127.0.0.1/sf_test';
  assert.equal(validateDisposableTestDatabase({ ...validInput, testDatabaseUrl }), testDatabaseUrl);
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

test('compares every additional application database target', () => {
  assert.throws(
    () => validateDisposableTestDatabase({
      ...validInput,
      applicationDatabaseUrls: [
        'postgresql://localhost/other',
        'postgres://another-user@127.0.0.1:5432/sf_test',
      ],
    }),
    /different PostgreSQL database from DATABASE_URL/,
  );
});

test('fails closed when any additional application target is malformed', () => {
  assert.throws(
    () => validateDisposableTestDatabase({
      ...validInput,
      applicationDatabaseUrls: ['postgresql://localhost/sf_safe', 'not-a-url'],
    }),
    /DATABASE_URL must be a valid PostgreSQL URL/,
  );
});

test('accepts distinct additional application database targets', () => {
  assert.equal(
    validateDisposableTestDatabase({
      ...validInput,
      applicationDatabaseUrls: ['postgresql://localhost/sf_dev_2', 'postgres://another-host/sf_test'],
    }),
    validInput.testDatabaseUrl,
  );
});
