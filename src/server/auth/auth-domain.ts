import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

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

export function validatePassword(password: string) {
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

async function derivePasswordKey(password: string, salt: Buffer) {
  return (await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })) as Buffer;
}

export async function hashPassword(password: string) {
  assertValidPassword(password);
  const salt = randomBytes(16);
  const key = await derivePasswordKey(password, salt);

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

export async function verifyPassword(password: string, encodedHash: string) {
  const parts = encodedHash.split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== PASSWORD_HASH_VERSION) {
    return false;
  }

  const [, , nValue, rValue, pValue, saltValue, hashValue] = parts;
  if (
    Number(nValue) !== SCRYPT_N ||
    Number(rValue) !== SCRYPT_R ||
    Number(pValue) !== SCRYPT_P
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(saltValue, 'base64url');
    const expected = Buffer.from(hashValue, 'base64url');
    if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) {
      return false;
    }

    const actual = await derivePasswordKey(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createSessionToken() {
  return randomBytes(AUTH_SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createSessionExpiry(now = new Date()) {
  return new Date(now.getTime() + AUTH_SESSION_TTL_MS);
}
