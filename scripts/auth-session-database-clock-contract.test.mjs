import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repository = readFileSync(new URL('../src/server/auth/auth-repository.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/server/auth/auth-service.ts', import.meta.url), 'utf8');
const signInRoute = readFileSync(new URL('../app/api/auth/sign-in/route.ts', import.meta.url), 'utf8');
const signUpRoute = readFileSync(new URL('../app/api/auth/sign-up/route.ts', import.meta.url), 'utf8');

test('session creation uses database-clock expiry and returns it to the browser boundary', () => {
  assert.match(repository, /SELECT statement_timestamp\(\) AS "now"/);
  assert.equal(repository.match(/createSessionExpiry\(await readDatabaseClock\(\)\)/g)?.length, 2);
  assert.match(repository, /return \{ user, expiresAt \};/);
  assert.match(repository, /return expiresAt;/);
  assert.match(service, /const \{ user, expiresAt \} = await createRegisteredUserWithSession/);
  assert.match(service, /const expiresAt = await createAuthSession/);
  assert.doesNotMatch(service, /createSessionExpiry\(/);
  // Both browser cookies must inherit the expiry returned by persisted session creation.
  assert.match(signInRoute, /expires: result\.expiresAt/);
  assert.match(signUpRoute, /expires: result\.expiresAt/);
});

test('session resolution and idempotent revocation use PostgreSQL clock and bind token digests', () => {
  assert.match(repository, /FROM "auth_sessions" AS s/);
  assert.match(repository, /INNER JOIN "users" AS u ON u\."id" = s\."userId"/);
  assert.match(repository, /s\."tokenHash" = \$\{tokenHash\}/);
  assert.match(repository, /s\."revokedAt" IS NULL/);
  assert.match(repository, /s\."expiresAt" > statement_timestamp\(\)/);
  assert.match(repository, /u\."status" = 'ACTIVE'/);
  assert.match(repository, /SET "revokedAt" = statement_timestamp\(\)/);
  assert.match(repository, /WHERE "tokenHash" = \$\{tokenHash\}/);
  assert.match(repository, /AND "revokedAt" IS NULL/);
  assert.doesNotMatch(repository, /new Date\(\)/);
});
