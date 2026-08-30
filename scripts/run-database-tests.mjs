import { spawnSync } from 'node:child_process';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for database integration tests.');
}

if (process.env.DATABASE_URL?.trim() === testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL must be different from DATABASE_URL so integration tests cannot target the normal application database.',
  );
}

const parsedUrl = new URL(testDatabaseUrl);

if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
  throw new Error('TEST_DATABASE_URL must use PostgreSQL.');
}

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

run(npmCommand, ['run', 'db:deploy']);
run(process.execPath, [
  '--test',
  'src/server/tenancy/tenant-isolation.integration.ts',
]);
