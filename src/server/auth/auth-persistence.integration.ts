import assert from 'node:assert/strict';
import test from 'node:test';

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

  try {
    const registration = await authService.registerWithPassword({
      email,
      password,
      displayName: 'Auth Test User',
    });
    userId = registration.user.id;

    const credential = await db.passwordCredential.findUnique({
      where: { userId },
    });
    assert.ok(credential);
    assert.equal(credential.passwordHash.includes(password), false);

    assert.equal(
      (await authService.resolveAuthSession(registration.token))?.user.id,
      userId,
    );

    await db.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { expiresAt: new Date('2000-01-01T00:00:00.000Z') },
    });
    assert.equal(await authService.resolveAuthSession(registration.token), null);

    const signedIn = await authService.signInWithPassword({ email, password });
    assert.equal(signedIn.user.id, userId);
    assert.equal(
      (await authService.resolveAuthSession(signedIn.token))?.user.id,
      userId,
    );

    await authService.signOutSession(signedIn.token);
    assert.equal(await authService.resolveAuthSession(signedIn.token), null);

    const signedInAgain = await authService.signInWithPassword({ email, password });
    await db.user.update({
      where: { id: userId },
      data: { status: 'SUSPENDED' },
    });
    assert.equal(await authService.resolveAuthSession(signedInAgain.token), null);
  } finally {
    if (userId) {
      await db.user.delete({ where: { id: userId } });
    }

    await db.$disconnect();
  }
});
