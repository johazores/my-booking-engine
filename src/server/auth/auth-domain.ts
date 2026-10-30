import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { hasUnsafeIdentityControls, normalizeUserEmail, validateUserEmail } from '../users/user-domain.ts';
import { runWithAuthCryptoCapacity } from './auth-crypto-capacity.ts';
import { assertAuthRequestNotAborted } from './auth-request-abort.ts';

const scrypt = promisify(scryptCallback);

export const AUTH_PASSWORD_MIN_LENGTH = 12;
export const AUTH_PASSWORD_MAX_LENGTH = 128;
export const AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
export const AUTH_SESSION_TOKEN_BYTES = 32;

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_N = 65_536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const PASSWORD_HASH_VERSION = '1';

export class AuthValidationError extends Error {}

/** Canonicalize browser credential identities with an auth-specific validation error. */
export function createCanonicalAuthEmail(value: string) {
  if (typeof value !== 'string' || hasUnsafeIdentityControls(value)) {
    throw new AuthValidationError('Enter a valid email address.');
  }
  const email = normalizeUserEmail(value);
  if (!validateUserEmail(email)) {
    throw new AuthValidationError('Enter a valid email address.');
  }
  return email;
}

export function validatePassword(password: string) {
  if (typeof password !== 'string' || !password.isWellFormed()) return false;
  const length = [...password].length;
  return length >= AUTH_PASSWORD_MIN_LENGTH && length <= AUTH_PASSWORD_MAX_LENGTH;
}

export function assertValidPassword(password: string) {
  if (!validatePassword(password)) {
    throw new AuthValidationError(
      `Password must be between ${AUTH_PASSWORD_MIN_LENGTH} and ${AUTH_PASSWORD_MAX_LENGTH} characters.`,
    );
  }
}

/** Validate all cheap credential input before reserving a shared authentication budget. */
export function validateSignInInput(input: { email: string; password: string }) {
  const email = createCanonicalAuthEmail(input.email);
  assertValidPassword(input.password);
  return { email, password: input.password };
}

export function validateSignUpInput(input: {
  email: string;
  password: string;
  displayName?: string;
}) {
  const { email, password } = validateSignInInput(input);
  let displayName: string | undefined;
  if (input.displayName !== undefined) {
    if (typeof input.displayName !== 'string' || hasUnsafeIdentityControls(input.displayName)) {
      throw new AuthValidationError('Display name must be between 1 and 160 characters when provided.');
    }
    displayName = input.displayName.trim();
    if (!displayName || [...displayName].length > 160) {
      throw new AuthValidationError('Display name must be between 1 and 160 characters when provided.');
    }
  }
  return { email, password, displayName };
}

async function derivePasswordKey(password: string, salt: Buffer, signal?: AbortSignal) {
  return runWithAuthCryptoCapacity(async () => (await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })) as Buffer, signal);
}

export async function hashPassword(password: string, signal?: AbortSignal) {
  assertValidPassword(password);
  assertAuthRequestNotAborted(signal);
  const salt = randomBytes(16);
  const key = await derivePasswordKey(password, salt, signal);

  return [
    'scrypt',
    PASSWORD_HASH_VERSION,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encodedHash: string, signal?: AbortSignal) {
  assertAuthRequestNotAborted(signal);
  if (!validatePassword(password) || typeof encodedHash !== 'string') return false;
  const parts = encodedHash.split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== PASSWORD_HASH_VERSION) {
    return false;
  }

  const [, , nValue, rValue, pValue, saltValue, hashValue] = parts;
  if (
    nValue !== String(SCRYPT_N) ||
    rValue !== String(SCRYPT_R) ||
    pValue !== String(SCRYPT_P)
  ) {
    return false;
  }

  // Reject decoder-tolerated aliases, padding, and corrupted stored hashes.
  if (!/^[A-Za-z0-9_-]{22}$/.test(saltValue) ||
      !/^[A-Za-z0-9_-]{86}$/.test(hashValue)) return false;
  const salt = Buffer.from(saltValue, 'base64url');
  const expected = Buffer.from(hashValue, 'base64url');
  if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH ||
      salt.toString('base64url') !== saltValue ||
      expected.toString('base64url') !== hashValue) {
    return false;
  }

  // Only malformed stored credentials are invalid-password results. Crypto
  // failures, queue exhaustion, and aborts must propagate as operational errors.
  const actual = await derivePasswordKey(password, salt, signal);
  return timingSafeEqual(actual, expected);
}

export function createSessionToken() {
  return randomBytes(AUTH_SESSION_TOKEN_BYTES).toString('base64url');
}

/** Reject malformed bearer cookies before hashing or querying the session store. */
export function isCanonicalSessionToken(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === AUTH_SESSION_TOKEN_BYTES && bytes.toString('base64url') === value;
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createSessionExpiry(now = new Date()) {
  return new Date(now.getTime() + AUTH_SESSION_TTL_MS);
}
