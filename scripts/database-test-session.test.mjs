import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { assertDisposableDatabaseSession, DatabaseTestSessionError } from './database-test-session.mjs';

test('accepts a verified public schema and the exact disposable database identity', () => {
  assert.doesNotThrow(() => assertDisposableDatabaseSession('postgresql://localhost:5432/sf_test?schema=public', {
    databaseName: 'sf_test', schemaName: 'public',
  }));
  assert.doesNotThrow(() => assertDisposableDatabaseSession('postgresql://localhost/sf_%C3%A9', {
    databaseName: 'sf_é', schemaName: 'public',
  }));
});

test('rejects an unexpected database, schema, missing schema, or missing row', () => {
  const url = 'postgresql://user:secret@localhost:5432/sf_test';
  for (const row of [
    { databaseName: 'sf_prod', schemaName: 'public' },
    { databaseName: 'sf_test', schemaName: 'tenant' },
    { databaseName: 'sf_test', schemaName: null },
    undefined,
  ]) {
    assert.throws(() => assertDisposableDatabaseSession(url, row), (error) => {
      assert.ok(error instanceof DatabaseTestSessionError);
      assert.ok(!error.message.includes('secret'));
      assert.ok(!error.message.includes('sf_prod'));
      return true;
    });
  }
});

test('database runner verifies the real PostgreSQL session before any Prisma command', () => {
  const runner = readFileSync(new URL('./run-database-tests.mjs', import.meta.url), 'utf8');
  const verify = runner.indexOf('await verifyDisposableDatabaseSession(testDatabaseUrl);');
  const prisma = runner.indexOf("run(npmCommand, ['run', 'prisma:validate']);");
  assert.ok(verify >= 0 && prisma > verify);
});

test('session verification bounds connection and read-only query waits', () => {
  const source = readFileSync(new URL('./database-test-session.mjs', import.meta.url), 'utf8');
  assert.match(source, /connectionTimeoutMillis: 5000/);
  assert.match(source, /query_timeout: 5000/);
});
