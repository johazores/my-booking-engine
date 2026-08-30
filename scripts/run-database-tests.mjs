import { spawnSync } from 'node:child_process';

import { validateDisposableTestDatabase } from './database-test-safety.mjs';

const testDatabaseUrl = validateDisposableTestDatabase({
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  applicationDatabaseUrl: process.env.DATABASE_URL,
  confirmation: process.env.SF_DATABASE_TEST_CONFIRM,
});

const env = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl,
  NODE_ENV: 'test',
};

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args) {
  const result = spawnSync(command, args, {
    env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(npmCommand, ['run', 'prisma:validate']);
run(npmCommand, ['run', 'db:deploy']);
run(npmCommand, ['run', 'db:status']);
run(npmCommand, ['run', 'db:drift']);
run(process.execPath, [
  '--test',
  'src/server/tenancy/tenant-isolation.integration.ts',
  'src/server/auth/auth-persistence.integration.ts',
  'src/server/authorization/authorization.integration.ts',
]);
