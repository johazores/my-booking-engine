import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertRequiredDatabaseIntegrationTests, discoverDatabaseIntegrationTests } from './database-integration-discovery.mjs';

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'sf-db-discovery-'));
  try {
    const server = join(root, 'src', 'server');
    mkdirSync(server, { recursive: true });
    return run(root, server);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('discovers nested integration tests in stable order without including unit tests', () => {
  withFixture((root, server) => {
    mkdirSync(join(server, 'bookings'), { recursive: true });
    mkdirSync(join(server, 'payments'), { recursive: true });
    writeFileSync(join(server, 'bookings', 'z.integration.ts'), '');
    writeFileSync(join(server, 'payments', 'a.integration.ts'), '');
    writeFileSync(join(server, 'payments', 'a.test.ts'), '');
    writeFileSync(join(server, 'payments', 'other.integration.ts.bak'), '');

    assert.deepEqual(discoverDatabaseIntegrationTests(root), [
      'src/server/bookings/z.integration.ts',
      'src/server/payments/a.integration.ts',
    ]);
  });
});

test('does not traverse symlinked directories or include symlinked test files', (t) => {
  withFixture((root, server) => {
    const external = join(root, 'external');
    mkdirSync(external);
    writeFileSync(join(external, 'outside.integration.ts'), '');
    writeFileSync(join(server, 'real.integration.ts'), '');
    try {
      symlinkSync(external, join(server, 'linked-directory'), 'dir');
      symlinkSync(join(external, 'outside.integration.ts'), join(server, 'linked.integration.ts'), 'file');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
        t.skip('Windows symlink creation requires elevated permissions.');
        return;
      }
      throw error;
    }

    assert.deepEqual(discoverDatabaseIntegrationTests(root), ['src/server/real.integration.ts']);
  });
});

test('fails closed rather than reporting success when no integration tests exist', () => {
  withFixture((root) => {
    assert.throws(
      () => discoverDatabaseIntegrationTests(root),
      /No database integration tests found/,
    );
  });
});

test('rejects symbolic-link src and src/server roots', (t) => {
  for (const rootName of ['src', 'server']) {
    withFixture((root, server) => {
      const external = join(root, 'external');
      mkdirSync(join(external, 'server'), { recursive: true });
      const target = rootName === 'src' ? join(root, 'src') : server;
      rmSync(target, { recursive: true });
      try {
        symlinkSync(external, target, 'dir');
      } catch (error) {
        if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
          t.skip('Windows symlink creation requires elevated permissions.');
          return;
        }
        throw error;
      }
      assert.throws(() => discoverDatabaseIntegrationTests(root), /real directories/);
    });
  }
});

test('mandatory suite manifest permits new suites but rejects missing or duplicate entries', () => {
  assert.doesNotThrow(() => assertRequiredDatabaseIntegrationTests(['a'], ['a', 'new']));
  assert.throws(() => assertRequiredDatabaseIntegrationTests(['missing'], ['a']), /Required database integration tests missing/);
  assert.throws(() => assertRequiredDatabaseIntegrationTests(['a', 'a'], ['a']), /Duplicate database integration test entries/);
  assert.throws(() => assertRequiredDatabaseIntegrationTests(['a'], ['a', 'a']), /Duplicate database integration test entries/);
});

test('database runner bounds file-level concurrency after migration and drift checks', () => {
  const runner = readFileSync(new URL('./run-database-tests.mjs', import.meta.url), 'utf8');
  const drift = runner.indexOf("run(npmCommand, ['run', 'db:drift']);");
  const integrationRun = runner.indexOf("run(process.execPath, ['--test', '--test-concurrency=1', ...discoveredDatabaseIntegrationTests]);");
  assert.ok(drift >= 0, 'migration drift verification must be present');
  assert.ok(integrationRun > drift, 'all discovered suites must run serially after drift verification');
});
