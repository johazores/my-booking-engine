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
  const [{ db }, authService] = await Promise.all([
    import('../database.ts'),
    import('./auth-service.ts'),
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
    await db.user.update({
      where: { id: userId },
      data: { status: 'SUSPENDED' },
    });
    assert.equal(await authService.resolveAuthSession(signedInAgain.token), null);
  } finally {
    try {
      // Registration can persist a user before a later step fails to return its ID.
      await db.user.deleteMany({ where: { email } });
    } finally {
      await db.$disconnect();
    }
  }
});
