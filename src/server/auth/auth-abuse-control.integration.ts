import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
  throw new Error('Auth abuse integration requires the validated disposable TEST_DATABASE_URL.');
}

test('auth attempt budgets are durable, concurrent, and identity-scoped', async () => {
  const originalSecret = process.env.SF_AUTH_ABUSE_SECRET;
  process.env.SF_AUTH_ABUSE_SECRET = randomBytes(32).toString('base64url');
  const [{ db }, { reserveAuthAttempt }, domain] = await Promise.all([
    import('../database.ts'), import('./auth-abuse-repository.ts'), import('./auth-abuse-domain.ts'),
  ]);
  const firstEmail = `auth-limit-${randomUUID()}@example.test`;
  const otherEmail = `auth-limit-${randomUUID()}@example.test`;
  const key = domain.decodeAuthAbuseSecret(process.env.SF_AUTH_ABUSE_SECRET);
  const firstDigest = domain.createAuthAttemptDigest('sign-in', 'identity', firstEmail, key);
  const otherDigest = domain.createAuthAttemptDigest('sign-in', 'identity', otherEmail, key);
  const signupDigest = domain.createAuthAttemptDigest('sign-up', 'identity', firstEmail, key);
  const signinGlobalDigest = domain.createAuthAttemptDigest('sign-in', 'global', '', key);
  const signupGlobalDigest = domain.createAuthAttemptDigest('sign-up', 'global', '', key);

  try {
    const attempts = await Promise.all(Array.from({ length: 14 },
      () => reserveAuthAttempt('sign-in', firstEmail)));
    assert.equal(attempts.filter((result) => result.allowed).length, 10);
    assert.equal(attempts.filter((result) => !result.allowed).length, 4);
    assert.ok(attempts.every((result) => result.allowed || result.retryAfterSeconds === 900));
    assert.equal((await reserveAuthAttempt('sign-in', otherEmail)).allowed, true);
    const signupAttempts = await Promise.all(Array.from({ length: 5 },
      () => reserveAuthAttempt('sign-up', firstEmail)));
    assert.equal(signupAttempts.filter((result) => result.allowed).length, 4);
    assert.equal(signupAttempts.filter((result) => !result.allowed).length, 1);
    const windows = await db.authAttemptWindow.findMany({
      where: { subjectHash: { in: [firstDigest, otherDigest, signupDigest] } },
    });
    assert.equal(windows.length, 3);
    assert.equal(windows.find((row) => row.subjectHash === firstDigest)?.attempts, 10);
    assert.equal(windows.find((row) => row.subjectHash === signupDigest)?.attempts, 4);
    assert.ok(windows.every((row) => !JSON.stringify(row).includes(firstEmail)));
    assert.ok(windows.every((row) => !JSON.stringify(row).includes(otherEmail)));
    delete process.env.SF_AUTH_ABUSE_SECRET;
    await assert.rejects(() => reserveAuthAttempt('sign-in', firstEmail), /SF_AUTH_ABUSE_SECRET/);
  } finally {
    await db.authAttemptWindow.deleteMany({
      where: { subjectHash: { in: [
        firstDigest, otherDigest, signupDigest, signinGlobalDigest, signupGlobalDigest,
      ] } },
    });
    if (originalSecret === undefined) delete process.env.SF_AUTH_ABUSE_SECRET;
    else process.env.SF_AUTH_ABUSE_SECRET = originalSecret;
    await db.$disconnect();
  }
});
