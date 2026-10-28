import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readLocalApplicationDatabaseUrls } from './database-test-environment.mjs';
import { DATABASE_TEST_CONFIRMATION, validateDisposableTestDatabase } from './database-test-safety.mjs';

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'sf-db-env-'));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const validInput = {
  testDatabaseUrl: 'postgresql://localhost:5432/sf_test',
  applicationDatabaseUrl: 'postgresql://localhost:5432/sf_dev',
  confirmation: DATABASE_TEST_CONFIRMATION,
};

function validateWithLocalFiles(root) {
  return validateDisposableTestDatabase({
    ...validInput,
    applicationDatabaseUrls: readLocalApplicationDatabaseUrls(root),
  });
}

test('returns no application targets when local environment files are absent', () => {
  withFixture((root) => assert.deepEqual(readLocalApplicationDatabaseUrls(root), []));
});

test('reads every local application target without importing test confirmation or target', () => {
  withFixture((root) => {
    const variants = [
      '.env', '.env.local', '.env.development', '.env.development.local',
      '.env.production', '.env.production.local', '.env.test', '.env.test.local',
    ];
    const confirmationBefore = process.env.SF_DATABASE_TEST_CONFIRM;
    const targetBefore = process.env.TEST_DATABASE_URL;
    for (const [index, filename] of variants.entries()) {
      writeFileSync(join(root, filename), `DATABASE_URL="postgresql://localhost:5432/sf_app_${index}"\nTEST_DATABASE_URL=postgresql://localhost/sf_test\nSF_DATABASE_TEST_CONFIRM=sf-disposable-test-database\n`);
    }
    assert.deepEqual(readLocalApplicationDatabaseUrls(root), variants.map((_, i) => `postgresql://localhost:5432/sf_app_${i}`));
    assert.equal(validateWithLocalFiles(root), validInput.testDatabaseUrl);
    assert.equal(process.env.SF_DATABASE_TEST_CONFIRM, confirmationBefore);
    assert.equal(process.env.TEST_DATABASE_URL, targetBefore);
  });
});

test('ignores files without application database targets and blank assignments', () => {
  withFixture((root) => {
    writeFileSync(join(root, '.env'), 'TEST_DATABASE_URL=postgresql://localhost/sf_test\n');
    writeFileSync(join(root, '.env.local'), 'DATABASE_URL=  \n');
    assert.deepEqual(readLocalApplicationDatabaseUrls(root), []);
  });
});

test('rejects application target reused through any local environment variant', () => {
  const variants = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local', '.env.test', '.env.test.local'];
  for (const filename of variants) {
    withFixture((root) => {
      writeFileSync(join(root, filename), 'DATABASE_URL="postgres://other-user@127.0.0.1:5432/sf_test"\n');
      assert.throws(() => validateWithLocalFiles(root), /different PostgreSQL database from DATABASE_URL/, filename);
    });
  }
});

test('fails closed on malformed application target in a local file', () => {
  withFixture((root) => {
    writeFileSync(join(root, '.env.production.local'), 'DATABASE_URL=not-a-url\n');
    assert.throws(() => validateWithLocalFiles(root), /DATABASE_URL must be a valid PostgreSQL URL/);
  });
});

test('fails closed on unreadable local environment file', () => {
  withFixture((root) => {
    mkdirSync(join(root, '.env'));
    assert.throws(() => readLocalApplicationDatabaseUrls(root), /Cannot read \.env/);
  });
});

test('does not print environment file contents in a read failure', () => {
  withFixture((root) => {
    mkdirSync(join(root, '.env.production'));
    assert.throws(() => readLocalApplicationDatabaseUrls(root), (error) => {
      assert.match(error.message, /Cannot read \.env.production/);
      assert.equal(error.cause, undefined);
      return true;
    });
  });
});

test('parses dotenv export syntax without evaluating or expanding values', () => {
  withFixture((root) => {
    writeFileSync(join(root, '.env'), 'export DATABASE_URL=postgresql://localhost/sf_dev\n');
    assert.deepEqual(readLocalApplicationDatabaseUrls(root), ['postgresql://localhost/sf_dev']);
    assert.equal(validateWithLocalFiles(root), validInput.testDatabaseUrl);
  });
});

test('fails closed when an application target is an unresolved interpolation', () => {
  withFixture((root) => {
    writeFileSync(join(root, '.env.local'), 'DATABASE_URL=${APP_DATABASE_URL}\n');
    assert.throws(() => validateWithLocalFiles(root), /DATABASE_URL must be a valid PostgreSQL URL/);
  });
});

test('rejects PGPORT from every local env variant before database operations', () => {
  const variants = [
    '.env', '.env.local', '.env.development', '.env.development.local',
    '.env.production', '.env.production.local', '.env.test', '.env.test.local',
  ];
  for (const filename of variants) {
    withFixture((root) => {
      writeFileSync(join(root, filename), 'PGPORT=6543\nDATABASE_URL=postgresql://localhost:5432/sf_app\n');
      assert.throws(
        () => readLocalApplicationDatabaseUrls(root),
        /PGPORT in \.env.* is not supported for disposable database tests/,
        filename,
      );
    });
  }
});

test('ignores blank local PGPORT values without changing URL comparisons', () => {
  withFixture((root) => {
    writeFileSync(join(root, '.env'), 'PGPORT="  "\nDATABASE_URL=postgresql://localhost:5432/sf_app\n');
    assert.deepEqual(readLocalApplicationDatabaseUrls(root), ['postgresql://localhost:5432/sf_app']);
  });
});
