import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTH_SESSION_TTL_MS, hashSessionToken } from './auth-domain.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseUrl = process.env.DATABASE_URL;

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error(
    'Authentication integration tests require DATABASE_URL to be the validated TEST_DATABASE_URL.',
  );
}

test('password registration, session expiry, revocation, sign-in, and user suspension persist safely', async () => {
  const [{ db }, authService, authRepository] = await Promise.all([
    import('../database.ts'),
    import('./auth-service.ts'),
    import('./auth-repository.ts'),
  ]);

  const suffix = crypto.randomUUID();
  const email = `sf-auth-${suffix}@example.test`;
  const password = 'correct horse battery staple';
  let userId: string | undefined;

  async function assertDatabaseClockSessionExpiry(token: string, expectedExpiry: Date) {
    const session = await db.authSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    });
    assert.ok(session);
    assert.equal(session.expiresAt.getTime(), expectedExpiry.getTime());
    const rows = await db.$queryRaw<Array<{ now: Date }>>`SELECT statement_timestamp() AS "now"`;
    assert.equal(rows.length, 1);
    const remainingMs = expectedExpiry.getTime() - rows[0].now.getTime();
    assert.ok(remainingMs > AUTH_SESSION_TTL_MS - 60_000);
    assert.ok(remainingMs <= AUTH_SESSION_TTL_MS);
  }

  try {
    await assert.rejects(
      () => authService.registerWithPassword({ email: 'invalid', password }),
      /valid email address/,
    );
    await assert.rejects(
      () => authService.signInWithPassword({ email: 'invalid', password }),
      /valid email address/,
    );
    await assert.rejects(
      () => authService.signInWithPassword({ email, password: 'too-short' }),
      /Password must be between/,
    );
    const abandoned = new AbortController();
    abandoned.abort();
    await assert.rejects(
      () => authService.registerWithPassword({ email, password }, abandoned.signal),
      { name: 'AuthRequestAbortedError' },
    );
    assert.equal(await db.user.count({ where: { email } }), 0);
    const registration = await authService.registerWithPassword({
      email,
      password,
      displayName: 'Auth Test User',
    });
    userId = registration.user.id;
    await assertDatabaseClockSessionExpiry(registration.token, registration.expiresAt);

    const credential = await db.passwordCredential.findUnique({
      where: { userId },
    });
    assert.ok(credential);
    assert.equal(credential.passwordHash.includes(password), false);

    assert.equal(
      (await authService.resolveAuthSession(registration.token))?.user.id,
      userId,
    );
    // Untrusted malformed cookies never resolve or revoke a persisted session.
    for (const invalidToken of ['', 'invalid', registration.token + '=', 'x'.repeat(8192)]) {
      assert.equal(await authService.resolveAuthSession(invalidToken), null);
      await authService.signOutSession(invalidToken);
    }
    assert.equal((await authService.resolveAuthSession(registration.token))?.user.id, userId);

    await db.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { expiresAt: new Date('2000-01-01T00:00:00.000Z') },
    });
    assert.equal(await authService.resolveAuthSession(registration.token), null);

    const abortedSignIn = new AbortController();
    abortedSignIn.abort();
    const sessionsBeforeAbort = await db.authSession.count({ where: { userId } });
    await assert.rejects(
      () => authService.signInWithPassword({ email, password }, abortedSignIn.signal),
      { name: 'AuthRequestAbortedError' },
    );
    assert.equal(await db.authSession.count({ where: { userId } }), sessionsBeforeAbort);
    const signedIn = await authService.signInWithPassword({ email, password });
    assert.equal(signedIn.user.id, userId);
    await assertDatabaseClockSessionExpiry(signedIn.token, signedIn.expiresAt);
    assert.equal(
      (await authService.resolveAuthSession(signedIn.token))?.user.id,
      userId,
    );

    await authService.signOutSession(signedIn.token);
    assert.equal(await authService.resolveAuthSession(signedIn.token), null);
    const revoked = await db.authSession.findUnique({
      where: { tokenHash: hashSessionToken(signedIn.token) },
    });
    assert.ok(revoked?.revokedAt);
    const clockRows = await db.$queryRaw<Array<{ now: Date }>>`SELECT statement_timestamp() AS "now"`;
    assert.equal(clockRows.length, 1);
    assert.ok(revoked.revokedAt.getTime() <= clockRows[0].now.getTime());
    assert.ok(revoked.revokedAt.getTime() >= clockRows[0].now.getTime() - 60_000);
    // Repeated sign-out must not rewrite the original revocation evidence.
    await authService.signOutSession(signedIn.token);
    const revokedAgain = await db.authSession.findUnique({
      where: { tokenHash: hashSessionToken(signedIn.token) },
    });
    assert.equal(revokedAgain?.revokedAt?.getTime(), revoked.revokedAt.getTime());

    const signedInAgain = await authService.signInWithPassword({ email, password });
    await assertDatabaseClockSessionExpiry(signedInAgain.token, signedInAgain.expiresAt);

    // Direct session persistence must recheck ACTIVE status, not trust a
    // credential read that could predate a concurrent suspension.
    const activeTokenHash = hashSessionToken(crypto.randomUUID());
    const activeExpiry = await authRepository.createAuthSession({ userId, tokenHash: activeTokenHash });
    assert.ok(activeExpiry instanceof Date);
    const activeRow = await db.authSession.findUnique({ where: { tokenHash: activeTokenHash } });
    assert.equal(activeRow?.expiresAt.getTime(), activeExpiry.getTime());

    // A session insert racing with an uncommitted suspension must wait for
    // the user row lock and then reject the newly suspended principal.
    let markSuspensionLocked!: () => void;
    let releaseSuspension!: () => void;
    const suspensionLocked = new Promise<void>((resolve) => { markSuspensionLocked = resolve; });
    const suspensionRelease = new Promise<void>((resolve) => { releaseSuspension = resolve; });
    const suspension = db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: 'SUSPENDED' },
      });
      markSuspensionLocked();
      await suspensionRelease;
    });
    const racingTokenHash = hashSessionToken(crypto.randomUUID());
    let racingSession: ReturnType<typeof authRepository.createAuthSession> | undefined;
    try {
      // If the update transaction fails before acquiring its lock, do not hang.
      await Promise.race([suspensionLocked, suspension.then(() => {
        throw new Error('Suspension transaction completed before its lock was observed.');
      })]);
      racingSession = authRepository.createAuthSession({ userId, tokenHash: racingTokenHash });
      let settled = false;
      void racingSession.then(() => { settled = true; }, () => { settled = true; });
      await new Promise<void>((resolve) => setTimeout(resolve, 75));
      assert.equal(settled, false, 'Session insertion must wait for the suspended user row lock.');
    } finally {
      releaseSuspension();
      await suspension;
    }
    assert.ok(racingSession);
    assert.equal(await racingSession, null);
    assert.equal(await db.authSession.findUnique({ where: { tokenHash: racingTokenHash } }), null);
    assert.equal(await authService.resolveAuthSession(signedInAgain.token), null);
    const beforeDeniedSession = await db.authSession.count({ where: { userId } });
    const suspendedTokenHash = hashSessionToken(crypto.randomUUID());
    assert.equal(await authRepository.createAuthSession({
      userId,
      tokenHash: suspendedTokenHash,
    }), null);
    assert.equal(await db.authSession.count({ where: { userId } }), beforeDeniedSession);
    assert.equal(await db.authSession.findUnique({ where: { tokenHash: suspendedTokenHash } }), null);
    await assert.rejects(
      () => authService.signInWithPassword({ email, password }),
      { name: 'InvalidCredentialsError' },
    );
  } finally {
    try {
      // Registration can persist a user before a later step fails to return its ID.
      await db.user.deleteMany({ where: { email } });
    } finally {
      await db.$disconnect();
    }
  }
});
