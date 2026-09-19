import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const migrationPath = 'prisma/migrations/20260919182000-rental-hold-trigger-wall-clock/migration.sql';

test('active rental hold trigger guards sample wall-clock time after the shared unit lock', async () => {
  const migration = await source(migrationPath);

  for (const functionName of [
    'sf_guard_rental_hold_overlap',
    'sf_guard_rental_block_against_holds',
    'sf_guard_rental_unit_mutation_against_holds',
  ]) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION ${functionName}\\(\\)`));
  }

  assert.doesNotMatch(migration, /CURRENT_TIMESTAMP/);
  assert.equal((migration.match(/wall_clock := clock_timestamp\(\);/g) ?? []).length, 3);
  assert.equal((migration.match(/hold\."expiresAt" > wall_clock/g) ?? []).length, 3);
  assert.match(migration, /NEW\."expiresAt" <= wall_clock/);
});

test('hold expiry is re-evaluated only after serialization for fresh active-hold writes', async () => {
  const migration = await source(migrationPath);
  const holdGuard = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION sf_guard_rental_hold_overlap()'),
    migration.indexOf('CREATE OR REPLACE FUNCTION sf_guard_rental_block_against_holds()'),
  );

  const lockIndex = holdGuard.indexOf('pg_advisory_xact_lock');
  const clockIndex = holdGuard.indexOf('wall_clock := clock_timestamp();');
  const expiryIndex = holdGuard.indexOf('NEW."expiresAt" <= wall_clock');

  assert.ok(lockIndex >= 0, 'hold overlap guard must retain physical-unit serialization');
  assert.ok(clockIndex > lockIndex, 'wall-clock authority must be sampled after waiting for the unit lock');
  assert.ok(expiryIndex > clockIndex, 'fresh hold expiry must be evaluated from the post-lock wall-clock sample');
});

test('documentation explains why transaction-start time is not live hold authority', async () => {
  const docs = await source('docs/rental-hold-database-clock-authority.md');

  assert.match(docs, /Historical trigger bodies used `CURRENT_TIMESTAMP`/);
  assert.match(docs, /transaction-start time/i);
  assert.match(docs, /samples `clock_timestamp\(\)` once after acquiring the shared tenant\/unit advisory lock/i);
  assert.match(docs, /waits on that lock across a hold-expiry boundary/i);
});
