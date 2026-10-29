import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  AUTH_ATTEMPT_LIMITS, AUTH_ATTEMPT_WINDOW_SECONDS,
  createAuthAttemptDigest, decodeAuthAbuseSecret,
} from './auth-abuse-domain.ts';

test('auth attempt secret requires canonical 32-byte base64url', () => {
  const secret = randomBytes(32).toString('base64url');
  assert.deepEqual(decodeAuthAbuseSecret(secret), Buffer.from(secret, 'base64url'));
  assert.throws(() => decodeAuthAbuseSecret(undefined));
  assert.throws(() => decodeAuthAbuseSecret('replace-with-a-secret'));
  assert.throws(() => decodeAuthAbuseSecret(secret + '='));
});

test('HMAC identities are canonical, secret-scoped, and do not expose emails', () => {
  const key = randomBytes(32);
  const first = createAuthAttemptDigest('sign-in', 'identity', ' User@Example.Test ', key);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first.includes('example'), false);
  assert.equal(first, createAuthAttemptDigest('sign-in', 'identity', 'user@example.test', key));
  assert.notEqual(first, createAuthAttemptDigest('sign-up', 'identity', 'user@example.test', key));
  assert.notEqual(first, createAuthAttemptDigest('sign-in', 'global', 'user@example.test', key));
  assert.notEqual(first, createAuthAttemptDigest('sign-in', 'identity', 'user@example.test', randomBytes(32)));
  assert.equal(createAuthAttemptDigest('sign-in', 'global', 'a@example.test', key),
    createAuthAttemptDigest('sign-in', 'global', 'b@example.test', key));
});

test('both credential routes have bounded identity and global budgets', () => {
  assert.equal(AUTH_ATTEMPT_WINDOW_SECONDS, 900);
  for (const limits of Object.values(AUTH_ATTEMPT_LIMITS)) {
    assert.ok(limits.identity > 0 && limits.global > limits.identity);
  }
});
