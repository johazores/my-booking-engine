import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  AUTH_SESSION_TOKEN_BYTES,
  AuthValidationError,
  assertValidPassword,
  createCanonicalAuthEmail,
  createSessionExpiry,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  validatePassword,
  validateSignInInput,
  validateSignUpInput,
  verifyPassword,
} from './auth-domain.ts';

test('password policy enforces bounded length without mutating the secret', () => {
  assert.equal(validatePassword('a'.repeat(AUTH_PASSWORD_MIN_LENGTH - 1)), false);
  assert.equal(validatePassword('a'.repeat(AUTH_PASSWORD_MIN_LENGTH)), true);
  assert.equal(validatePassword('a'.repeat(AUTH_PASSWORD_MAX_LENGTH)), true);
  assert.equal(validatePassword('a'.repeat(AUTH_PASSWORD_MAX_LENGTH + 1)), false);
  assert.equal(validatePassword(` ${'a'.repeat(AUTH_PASSWORD_MIN_LENGTH - 1)}`), true);
});

test('credential emails share canonical user identity rules and report validation errors', () => {
  assert.equal(createCanonicalAuthEmail('  User@Example.Test  '), 'user@example.test');
  for (const invalid of ['', 'invalid', 'missing-at.example.test', `${'a'.repeat(320)}@example.test`]) {
    assert.throws(() => createCanonicalAuthEmail(invalid), AuthValidationError);
  }
  assert.throws(() => assertValidPassword('too-short'), AuthValidationError);
  assert.throws(() => assertValidPassword('x'.repeat(AUTH_PASSWORD_MAX_LENGTH + 1)), AuthValidationError);
});

test('password hashes are salted, versioned, and verify only the original secret', async () => {
  const password = 'correct horse battery staple';
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('not the password', first), false);
  assert.equal(await verifyPassword(password, 'not-a-supported-hash'), false);
});

test('session tokens have high entropy and only their digest needs persistence', () => {
  const token = createSessionToken();
  const anotherToken = createSessionToken();

  assert.notEqual(token, anotherToken);
  assert.equal(Buffer.from(token, 'base64url').length, AUTH_SESSION_TOKEN_BYTES);
  assert.match(hashSessionToken(token), /^[a-f0-9]{64}$/);
  assert.notEqual(hashSessionToken(token), token);
});

test('session expiry is a fixed absolute window from creation', () => {
  const now = new Date('2026-08-30T12:00:00.000Z');
  assert.equal(createSessionExpiry(now).toISOString(), '2026-09-13T12:00:00.000Z');
});

test('sign-in pre-admission validation canonicalizes email without altering password', () => {
  const password = ` ${'x'.repeat(11)}`;
  assert.deepEqual(
    validateSignInInput({ email: ' User@Example.Test ', password }),
    { email: 'user@example.test', password },
  );
  for (const input of [
    { email: 'invalid', password: 'x'.repeat(12) },
    { email: 'user@example.test', password: 'short' },
    { email: 'user@example.test', password: 'x'.repeat(129) },
  ]) {
    assert.throws(() => validateSignInInput(input), AuthValidationError);
  }
});

test('sign-up pre-admission validation rejects invalid names and passwords', () => {
  const password = 'x'.repeat(12);
  assert.deepEqual(
    validateSignUpInput({ email: ' USER@example.test ', password, displayName: '  User  ' }),
    { email: 'user@example.test', password, displayName: 'User' },
  );
  assert.equal(validateSignUpInput({ email: 'user@example.test', password }).displayName, undefined);
  for (const displayName of ['', '   ', 'x'.repeat(161)]) {
    assert.throws(
      () => validateSignUpInput({ email: 'user@example.test', password, displayName }),
      AuthValidationError,
    );
  }
  assert.throws(
    () => validateSignUpInput({ email: 'user@example.test', password: 'short' }),
    AuthValidationError,
  );
});
