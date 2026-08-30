import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  AUTH_SESSION_TOKEN_BYTES,
  createSessionExpiry,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  validatePassword,
  verifyPassword,
} from './auth-domain.ts';

test('password policy enforces bounded length without mutating the secret', () => {
  assert.equal(validatePassword('a'.repeat(AUTH_PASSWORD_MIN_LENGTH - 1)), false);
  assert.equal(validatePassword('a'.repeat(AUTH_PASSWORD_MIN_LENGTH)), true);
  assert.equal(validatePassword('a'.repeat(AUTH_PASSWORD_MAX_LENGTH)), true);
  assert.equal(validatePassword('a'.repeat(AUTH_PASSWORD_MAX_LENGTH + 1)), false);
  assert.equal(validatePassword(` ${'a'.repeat(AUTH_PASSWORD_MIN_LENGTH - 1)}`), true);
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
