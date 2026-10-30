import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = (path) => readFileSync(resolve(root, path), 'utf8');

test('auth quota cleanup is oldest-first, bounded, and skips locked stale rows', () => {
  const repository = source('src/server/auth/auth-abuse-repository.ts');
  assert.match(repository, /AUTH_ATTEMPT_PRUNE_BATCH_SIZE = 256/);
  assert.match(repository, /SELECT ctid FROM "auth_attempt_windows"[\s\S]*?ORDER BY "windowStart"[\s\S]*?LIMIT \$\{AUTH_ATTEMPT_PRUNE_BATCH_SIZE\}[\s\S]*?FOR UPDATE SKIP LOCKED/);
  assert.match(repository, /DELETE FROM "auth_attempt_windows" AS windows[\s\S]*?WHERE windows\.ctid = stale\.ctid/);
  assert.match(repository, /pruneExpiredAuthAttemptWindowsBatch,\s*\);/);
});

test('disposable PostgreSQL suite covers bounded retention and active-window safety', () => {
  const integration = source('src/server/auth/auth-abuse-control.integration.ts');
  assert.match(integration, /retention prunes only a bounded batch and preserves active windows/);
  assert.match(integration, /deleted >= 1 && deleted <= 256/);
  assert.match(integration, /remainingStale >= 14/);
  assert.match(integration, /current admission windows must survive retention cleanup/);
});


test('optional retention only samples admitted attempts and cannot override admission', () => {
  const repository = source('src/server/auth/auth-abuse-repository.ts');
  const domain = source('src/server/auth/auth-abuse-domain.ts');
  assert.match(repository, /runBestEffortAuthRetention\(\s*decision\.allowed,\s*\(\) => randomBytes\(1\)\[0\] === 0,\s*pruneExpiredAuthAttemptWindowsBatch,/);
  assert.match(domain, /if \(!admitted\) return;\s*try \{\s*if \(shouldPrune\(\)\) await prune\(\);\s*\} catch \{/);
});
