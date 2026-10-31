import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { AuthRequestAbortedError } from './auth-request-abort.ts';
import {
  AUTH_ATTEMPT_LIMITS, AUTH_ATTEMPT_WINDOW_SECONDS,
  admitAuthAttemptWithBudgets, createAuthAttemptDigest, decodeAuthAbuseSecret, scheduleBestEffortAuthRetention,
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
    return { allowed: false, retryAfterSeconds: 17 };
  });
  assert.deepEqual(allowed, { allowed: false, retryAfterSeconds: 17 });
  assert.deepEqual(consumed, ['identity:10']);
});

test('admitted identities must also pass the deployment-wide quota', async () => {
  for (const globalAllowed of [true, false]) {
    const consumed: string[] = [];
    const allowed = await admitAuthAttemptWithBudgets(AUTH_ATTEMPT_LIMITS['sign-up'], async (scope, limit) => {
      consumed.push(`${scope}:${limit}`);
      return scope === 'identity' || globalAllowed
        ? { allowed: true }
        : { allowed: false, retryAfterSeconds: 23 };
    });
    assert.deepEqual(allowed, globalAllowed
      ? { allowed: true }
      : { allowed: false, retryAfterSeconds: 23 });
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

test('pre-aborted credential requests do not consume either quota', async () => {
  const controller = new AbortController();
  controller.abort();
  const consumed: string[] = [];
  await assert.rejects(
    () => admitAuthAttemptWithBudgets(AUTH_ATTEMPT_LIMITS['sign-in'], async (scope) => {
      consumed.push(scope);
      return { allowed: true };
    }, controller.signal),
    AuthRequestAbortedError,
  );
  assert.deepEqual(consumed, []);
});

test('abort after identity admission prevents the independent global quota write', async () => {
  const controller = new AbortController();
  const consumed: string[] = [];
  await assert.rejects(
    () => admitAuthAttemptWithBudgets(AUTH_ATTEMPT_LIMITS['sign-up'], async (scope) => {
      consumed.push(scope);
      controller.abort();
      return { allowed: true };
    }, controller.signal),
    AuthRequestAbortedError,
  );
  assert.deepEqual(consumed, ['identity']);
});

test('abort during the global quota write cannot refund admission but discards its result', async () => {
  const controller = new AbortController();
  const consumed: string[] = [];
  await assert.rejects(
    () => admitAuthAttemptWithBudgets(AUTH_ATTEMPT_LIMITS['sign-in'], async (scope) => {
      consumed.push(scope);
      if (scope === 'global') controller.abort();
      return { allowed: true };
    }, controller.signal),
    AuthRequestAbortedError,
  );
  assert.deepEqual(consumed, ['identity', 'global']);
});


test('optional auth retention never samples denied attempts or prunes unsampled admissions', async () => {
  const calls: string[] = [];
  scheduleBestEffortAuthRetention(false, () => { calls.push('sample'); return true; }, async () => { calls.push('prune'); });
  scheduleBestEffortAuthRetention(true, () => { calls.push('sample'); return false; }, async () => { calls.push('prune'); });
  await Promise.resolve();
  assert.deepEqual(calls, ['sample']);
});

test('optional auth retention never blocks credential admission on slow cleanup', async () => {
  let release!: () => void;
  let finished = false;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const result = scheduleBestEffortAuthRetention(true, () => true, async () => {
    await pending;
    finished = true;
  });
  assert.equal(result, undefined);
  await Promise.resolve();
  assert.equal(finished, false);
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(finished, true);
});

test('optional auth retention skips overlapping cleanup and resumes after settlement', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let prunes = 0;
  scheduleBestEffortAuthRetention(true, () => true, async () => { prunes += 1; await pending; });
  await Promise.resolve();
  scheduleBestEffortAuthRetention(true, () => true, async () => { prunes += 1; });
  await Promise.resolve();
  assert.equal(prunes, 1);
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  scheduleBestEffortAuthRetention(true, () => true, async () => { prunes += 1; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(prunes, 2);
});

test('optional auth retention contains sampling and cleanup failures without wedging future work', async () => {
  let prunes = 0;
  assert.doesNotThrow(() => scheduleBestEffortAuthRetention(true, () => {
    throw new Error('entropy unavailable');
  }, async () => { prunes += 1; }));
  scheduleBestEffortAuthRetention(true, () => true, () => { throw new Error('sync maintenance failure'); });
  await new Promise<void>((resolve) => setImmediate(resolve));
  scheduleBestEffortAuthRetention(true, () => true, async () => { throw new Error('async maintenance failure'); });
  await new Promise<void>((resolve) => setImmediate(resolve));
  scheduleBestEffortAuthRetention(true, () => true, async () => { prunes += 1; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(prunes, 1);
});
