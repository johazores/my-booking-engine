import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  AUTH_ATTEMPT_LIMITS, AUTH_ATTEMPT_WINDOW_SECONDS,
  admitAuthAttemptWithBudgets, createAuthAttemptDigest, decodeAuthAbuseSecret,
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

test('blocked identities do not spend shared admission capacity', async () => {
  const consumed: string[] = [];
  const allowed = await admitAuthAttemptWithBudgets(AUTH_ATTEMPT_LIMITS['sign-in'], async (scope, limit) => {
    consumed.push(`${scope}:${limit}`);
    return false;
  });
  assert.equal(allowed, false);
  assert.deepEqual(consumed, ['identity:10']);
});

test('admitted identities must also pass the deployment-wide quota', async () => {
  for (const globalAllowed of [true, false]) {
    const consumed: string[] = [];
    const allowed = await admitAuthAttemptWithBudgets(AUTH_ATTEMPT_LIMITS['sign-up'], async (scope, limit) => {
      consumed.push(`${scope}:${limit}`);
      return scope === 'identity' || globalAllowed;
    });
    assert.equal(allowed, globalAllowed);
    assert.deepEqual(consumed, ['identity:4', 'global:1500']);
  }
});

test('quota storage failures fail closed without continuing to the next scope', async () => {
  const consumed: string[] = [];
  await assert.rejects(() => admitAuthAttemptWithBudgets(AUTH_ATTEMPT_LIMITS['sign-in'], async (scope) => {
    consumed.push(scope);
    throw new Error('database unavailable');
  }), /database unavailable/);
  assert.deepEqual(consumed, ['identity']);
});
