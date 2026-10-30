import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = (path) => readFileSync(resolve(root, path), 'utf8');

test('both credential routes pass the browser abort signal into quota admission', () => {
  const signIn = source('app/api/auth/sign-in/route.ts');
  const signUp = source('app/api/auth/sign-up/route.ts');
  assert.match(signIn, /reserveAuthAttempt\(\s*'sign-in',\s*credentials\.email,\s*request\.signal\s*\)/);
  assert.match(signUp, /reserveAuthAttempt\(\s*'sign-up',\s*registration\.email,\s*request\.signal\s*\)/);
});

test('database quota admission checks abort state and forwards it between scopes', () => {
  const repository = source('src/server/auth/auth-abuse-repository.ts');
  const domain = source('src/server/auth/auth-abuse-domain.ts');
  assert.match(repository, /reserveAuthAttempt\([^)]*signal\?: AbortSignal\)/);
  assert.match(repository, /assertAuthRequestNotAborted\(signal\)/);
  assert.match(repository, /consumeWindow\([^;]*\), signal\)/);
  assert.match(repository, /assertAuthRequestNotAborted\(signal\);\s*await runBestEffortAuthRetention\(\s*decision\.allowed,/);
  assert.match(domain, /assertAuthRequestNotAborted\(signal\);\s*const identity/);
  assert.match(domain, /const identity = await consume\('identity', limits\.identity\);\s*assertAuthRequestNotAborted\(signal\)/);
  assert.match(domain, /const global = await consume\('global', limits\.global\);\s*assertAuthRequestNotAborted\(signal\)/);
});
