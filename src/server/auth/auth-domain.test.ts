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
  isCanonicalSessionToken,
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
  assert.equal(await verifyPassword(password, null as unknown as string), false);
  const parts = first.split('$');
  const altered = (index: number, value: string) =>
    parts.map((part, partIndex) => partIndex === index ? value : part).join('$');
  assert.equal(await verifyPassword(password, altered(2, '0' + parts[2])), false);
  assert.equal(await verifyPassword(password, altered(5, parts[5] + '=')), false);
  assert.equal(await verifyPassword(password, altered(6, parts[6] + '=')), false);
  // The last base64url character has unused bits; the decoder tolerates aliases.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = parts[6].at(-1)!;
  const alias = alphabet[alphabet.indexOf(last) ^ 1];
  assert.equal(await verifyPassword(password, altered(6, parts[6].slice(0, -1) + alias)), false);
  const saltLast = parts[5].at(-1)!;
  const saltAlias = alphabet[alphabet.indexOf(saltLast) ^ 1];
  assert.equal(await verifyPassword(password, altered(5, parts[5].slice(0, -1) + saltAlias)), false);
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

test('canonical session tokens reject noncanonical, oversized, and malformed bearer cookies', () => {
  const token = createSessionToken();
  assert.equal(isCanonicalSessionToken(token), true);
  for (const invalid of [
    '', 'short', token + '=', token + 'A', token.slice(1),
    token.slice(0, -1) + '!', 'x'.repeat(8192), null, undefined, 42,
  ]) {
    assert.equal(isCanonicalSessionToken(invalid), false);
  }
  // Last base64url character for 32 bytes has only four canonical values.
  const final = token.at(-1)!;
  const lastCharIndex = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(final);
  const alternate = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[lastCharIndex ^ 1];
  assert.equal(isCanonicalSessionToken(token.slice(0, -1) + alternate), false);
});

test('authentication validators reject unsafe identity controls and malformed runtime inputs', () => {
  const password = 'x'.repeat(12);
  for (const email of ['a\u0000b@example.test', 'a\u0085b@example.test', 'a\u202eb@example.test', 'a\ud800@example.test', 'a\u200bb@example.test', 'a\u200eb@example.test', 'a\u061cb@example.test', 'a\u00adb@example.test', 'a\u034fb@example.test', 'a\u200cb@example.test', 'a\u{e0001}b@example.test']) {
    assert.throws(() => validateSignInInput({ email, password }), AuthValidationError);
  }
  for (const displayName of ['Admin\u0000Root', 'Admin\u202eRoot', 'Admin\u2066Root', 'Admin\ud800Root', 'Admin\u2060Root', 'Admin\u200fRoot', 'Admin\u206aRoot', 'Admin\u00adRoot', 'Admin\u034fRoot', 'Admin\u200dRoot', 'Admin\ufe0fRoot']) {
    assert.throws(() => validateSignUpInput({ email: 'user@example.test', password, displayName }), AuthValidationError);
  }
  assert.equal(validateSignUpInput({ email: 'user@example.test', password, displayName: 'Renée 李' }).displayName, 'Renée 李');
  assert.throws(() => createCanonicalAuthEmail(null as unknown as string), AuthValidationError);
  assert.throws(() => createCanonicalAuthEmail('\ufeffuser@example.test'), AuthValidationError);
  assert.throws(() => createCanonicalAuthEmail('\nuser@example.test'), AuthValidationError);
  assert.throws(() => assertValidPassword(null as unknown as string), AuthValidationError);
  assert.throws(() => validateSignUpInput({ email: 'user@example.test', password, displayName: 12 as unknown as string }), AuthValidationError);
});
