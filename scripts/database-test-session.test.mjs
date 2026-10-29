import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { assertDisposableDatabaseSession, DatabaseTestSessionError } from './database-test-session.mjs';

const healthySession = {
  databaseName: 'sf_test', schemaName: 'public', replicationRole: 'origin', rowSecurity: 'on',
};

test('accepts the expected database, public schema, and enabled integrity settings', () => {
  assert.doesNotThrow(() => assertDisposableDatabaseSession('postgresql://localhost:5432/sf_test?schema=public', {
    ...healthySession,
  }));
  assert.doesNotThrow(() => assertDisposableDatabaseSession('postgresql://localhost/sf_%C3%A9', {
    ...healthySession, databaseName: 'sf_é',
  }));
});

test('rejects an unexpected database, schema, missing schema, or missing row', () => {
  const url = 'postgresql://user:secret@localhost:5432/sf_test';
  for (const row of [
    { ...healthySession, databaseName: 'sf_prod' },
    { ...healthySession, schemaName: 'tenant' },
    { ...healthySession, schemaName: null },
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

test('rejects replication settings that bypass ordinary integrity triggers', () => {
  for (const replicationRole of ['replica', 'local', null, undefined, 'ORIGIN']) {
    assert.throws(() => assertDisposableDatabaseSession('postgresql://user:secret@localhost/sf_test', {
      ...healthySession, replicationRole,
    }), (error) => {
      assert.ok(error instanceof DatabaseTestSessionError);
      assert.match(error.message, /session_replication_role.*origin/);
      assert.ok(!error.message.includes('secret'));
      return true;
    });
  }
});

test('rejects disabled or unverified row-level security defaults', () => {
  for (const rowSecurity of ['off', null, undefined, 'ON']) {
    assert.throws(() => assertDisposableDatabaseSession('postgresql://user:secret@localhost/sf_test', {
      ...healthySession, rowSecurity,
    }), (error) => {
      assert.ok(error instanceof DatabaseTestSessionError);
      assert.match(error.message, /row_security.*on/);
      assert.ok(!error.message.includes('secret'));
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
  assert.ok(source.includes("current_setting('session_replication_role')"));
  assert.ok(source.includes("current_setting('row_security')"));
});
