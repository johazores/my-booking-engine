import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, repositoryRoot), 'utf8');
}

test('Prisma config and drift validation use the complete multi-file schema directory', async () => {
  const [config, packageSource] = await Promise.all([
    source('prisma.config.ts'),
    source('package.json'),
  ]);
  const packageJson = JSON.parse(packageSource);
  const driftCommand = packageJson.scripts?.['db:drift'];

  assert.match(config, /schema:\s*['"]prisma\/?['"]/);
  assert.equal(
    driftCommand,
    'prisma migrate diff --from-schema prisma --to-config-datasource --exit-code',
  );
  assert.doesNotMatch(driftCommand, /prisma\/schema\.prisma/);
  assert.equal(
    packageJson.scripts?.validate,
    'npm run prisma:validate && npm run prisma:generate && npm run typecheck && npm run lint && npm run test && npm run build',
  );
});

test('disposable database runner regenerates the current client before migration and integration checks', async () => {
  const runner = await source('scripts/run-database-tests.mjs');
  const expectedSequence = [
    "run(npmCommand, ['run', 'prisma:validate']);",
    "run(npmCommand, ['run', 'prisma:generate']);",
    "run(npmCommand, ['run', 'db:deploy']);",
    "run(npmCommand, ['run', 'db:status']);",
    "run(npmCommand, ['run', 'db:drift']);",
    "run(process.execPath, [",
  ];

  let previousOffset = -1;
  for (const step of expectedSequence) {
    const offset = runner.indexOf(step);
    assert.ok(offset > previousOffset, `${step} must run in the expected validation order.`);
    previousOffset = offset;
  }
});

test('development guide records the multi-file drift and raw SQL verification boundaries', async () => {
  const guide = await source('docs/development-guide.md');

  assert.match(guide, /complete multi-file Prisma schema/i);
  assert.match(guide, /must point at the `prisma` directory rather than only `prisma\/schema\.prisma`/i);
  assert.match(guide, /Raw SQL constraints that Prisma does not model are verified by the guarded PostgreSQL integration scenarios/i);
  assert.match(guide, /regenerates the current Prisma client/i);
  assert.match(guide, /schema-first sequence/i);
});
