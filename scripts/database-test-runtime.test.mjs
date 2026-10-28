import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { assertSupportedDatabaseTestRuntime } from './database-test-runtime.mjs';

test('accepts supported Node 24 patch releases for database migration validation', () => {
  for (const version of ['24.20.0', '24.20.1', '24.21.0', '24.99.99']) {
    assert.doesNotThrow(() => assertSupportedDatabaseTestRuntime(version), version);
  }
});

test('fails closed before database operations on unsupported or malformed Node versions', () => {
  for (const version of ['22.16.0', '23.99.99', '24.19.99', '25.0.0', '26.0.0', '24.20.0-rc.1', 'invalid']) {
    assert.throws(
      () => assertSupportedDatabaseTestRuntime(version),
      /Database integration tests require Node\.js >=24\.20\.0 <25/,
      version,
    );
  }
});

test('database runner checks runtime before target validation and migrations', () => {
  const runner = readFileSync(new URL('./run-database-tests.mjs', import.meta.url), 'utf8');
  const runtimeGuard = runner.indexOf('assertSupportedDatabaseTestRuntime();');
  const targetGuard = runner.indexOf('const testDatabaseUrl = validateDisposableTestDatabase(');
  const migration = runner.indexOf("run(npmCommand, ['run', 'db:deploy']);");
  assert.ok(runtimeGuard >= 0, 'runner must enforce the Node runtime');
  assert.ok(targetGuard > runtimeGuard, 'runtime must be checked before target validation');
  assert.ok(migration > targetGuard, 'migration deployment must follow both preflights');
});
