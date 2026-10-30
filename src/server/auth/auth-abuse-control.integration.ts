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
  const globalBoundaryEmail = `auth-limit-${randomUUID()}@example.test`;
  const key = domain.decodeAuthAbuseSecret(process.env.SF_AUTH_ABUSE_SECRET);
  const firstDigest = domain.createAuthAttemptDigest('sign-in', 'identity', firstEmail, key);
  const otherDigest = domain.createAuthAttemptDigest('sign-in', 'identity', otherEmail, key);
  const globalBoundaryDigest = domain.createAuthAttemptDigest('sign-in', 'identity', globalBoundaryEmail, key);
  const signupDigest = domain.createAuthAttemptDigest('sign-up', 'identity', firstEmail, key);
  const signinGlobalDigest = domain.createAuthAttemptDigest('sign-in', 'global', '', key);
  const signupGlobalDigest = domain.createAuthAttemptDigest('sign-up', 'global', '', key);
  const concurrentEmails = Array.from({ length: 8 },
    () => `auth-limit-${randomUUID()}@example.test`);
  const concurrentDigests = concurrentEmails.map((email) =>
    domain.createAuthAttemptDigest('sign-in', 'identity', email, key));

  try {
    const attempts = await Promise.all(Array.from({ length: 14 },
      () => reserveAuthAttempt('sign-in', firstEmail)));
    assert.equal(attempts.filter((result) => result.allowed).length, 10);
    assert.equal(attempts.filter((result) => !result.allowed).length, 4);
    assert.ok(attempts.every((result) => result.allowed ||
      (result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= 900)));
    assert.equal((await reserveAuthAttempt('sign-in', otherEmail)).allowed, true);
    const signupAttempts = await Promise.all(Array.from({ length: 5 },
      () => reserveAuthAttempt('sign-up', firstEmail)));
    assert.equal(signupAttempts.filter((result) => result.allowed).length, 4);
    assert.equal(signupAttempts.filter((result) => !result.allowed).length, 1);
    const windows = await db.authAttemptWindow.findMany({
      where: { subjectHash: { in: [firstDigest, otherDigest, signupDigest, signinGlobalDigest, signupGlobalDigest] } },
    });
    assert.equal(windows.length, 5);
    assert.equal(windows.find((row) => row.subjectHash === firstDigest)?.attempts, 10);
    assert.equal(windows.find((row) => row.subjectHash === otherDigest)?.attempts, 1);
    assert.equal(windows.find((row) => row.subjectHash === signupDigest)?.attempts, 4);
    assert.equal(windows.find((row) => row.subjectHash === signinGlobalDigest)?.attempts, 11);
    assert.equal(windows.find((row) => row.subjectHash === signupGlobalDigest)?.attempts, 4);
    const blockedFlood = await Promise.all(Array.from({ length: 8 },
      () => reserveAuthAttempt('sign-in', firstEmail)));
    assert.ok(blockedFlood.every((result) => !result.allowed));
    const globalAfterFlood = await db.authAttemptWindow.findFirst({
      where: { operation: 'sign-in', scope: 'global', subjectHash: signinGlobalDigest },
    });
    assert.equal(globalAfterFlood?.attempts, 11);

    // Exercise the actual shared quota boundary without thousands of
    // expensive credential attempts. Global denial still spends identity quota.
    const globalLimit = domain.AUTH_ATTEMPT_LIMITS['sign-in'].global;
    const prepared = await db.authAttemptWindow.updateMany({
      where: { operation: 'sign-in', scope: 'global', subjectHash: signinGlobalDigest },
      data: { attempts: globalLimit - 1 },
    });
    assert.equal(prepared.count, 1);
    assert.equal((await reserveAuthAttempt('sign-in', globalBoundaryEmail)).allowed, true);
    const deniedByGlobal = await reserveAuthAttempt('sign-in', globalBoundaryEmail);
    assert.equal(deniedByGlobal.allowed, false);
    if (!deniedByGlobal.allowed) {
      assert.ok(deniedByGlobal.retryAfterSeconds >= 1 &&
        deniedByGlobal.retryAfterSeconds <= domain.AUTH_ATTEMPT_WINDOW_SECONDS);
    }
    const globalAtLimit = await db.authAttemptWindow.findFirst({
      where: { operation: 'sign-in', scope: 'global', subjectHash: signinGlobalDigest },
    });
    assert.equal(globalAtLimit?.attempts, globalLimit);
    const boundaryIdentity = await db.authAttemptWindow.findFirst({
      where: { operation: 'sign-in', scope: 'identity', subjectHash: globalBoundaryDigest },
    });
    assert.equal(boundaryIdentity?.attempts, 2);

    // Concurrent distinct identities cannot overshoot the shared limit.
    const resetGlobal = await db.authAttemptWindow.updateMany({
      where: { operation: 'sign-in', scope: 'global', subjectHash: signinGlobalDigest },
      data: { attempts: globalLimit - 2 },
    });
    assert.equal(resetGlobal.count, 1);
    const concurrent = await Promise.all(concurrentEmails.map((email) =>
      reserveAuthAttempt('sign-in', email)));
    assert.equal(concurrent.filter((result) => result.allowed).length, 2);
    assert.equal(concurrent.filter((result) => !result.allowed).length, 6);
    const globalAfterConcurrency = await db.authAttemptWindow.findFirst({
      where: { operation: 'sign-in', scope: 'global', subjectHash: signinGlobalDigest },
    });
    assert.equal(globalAfterConcurrency?.attempts, globalLimit);
    assert.ok(windows.every((row) => !JSON.stringify(row).includes(firstEmail)));
    assert.ok(windows.every((row) => !JSON.stringify(row).includes(otherEmail)));
    delete process.env.SF_AUTH_ABUSE_SECRET;
    await assert.rejects(() => reserveAuthAttempt('sign-in', firstEmail), /SF_AUTH_ABUSE_SECRET/);
  } finally {
    await db.authAttemptWindow.deleteMany({
      where: { subjectHash: { in: [
        firstDigest, otherDigest, globalBoundaryDigest, signupDigest, signinGlobalDigest, signupGlobalDigest,
        ...concurrentDigests,
      ] } },
    });
    if (originalSecret === undefined) delete process.env.SF_AUTH_ABUSE_SECRET;
    else process.env.SF_AUTH_ABUSE_SECRET = originalSecret;
    await db.$disconnect();
  }
});
