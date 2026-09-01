import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const ENVELOPE_VERSION = 'v1';
const MASTER_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type IntegrationCredentials = Readonly<Record<string, string>>;

export function normalizeIntegrationCredentials(value: unknown): IntegrationCredentials {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Integration credentials must be an object.');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 20) throw new Error('Integration credentials must contain between 1 and 20 values.');

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    if (!/^[a-z][a-zA-Z0-9]{1,63}$/.test(key)) throw new Error('Integration credential keys are invalid.');
    if (typeof rawValue !== 'string') throw new Error(`Integration credential ${key} must be a string.`);
    const credential = rawValue.trim();
    if (!credential || credential.length > 4096) throw new Error(`Integration credential ${key} is invalid.`);
    normalized[key] = credential;
  }
  return Object.freeze(normalized);
}

export function readIntegrationMasterKey(value = process.env.SF_INTEGRATION_MASTER_KEY): Buffer {
  if (!value || !MASTER_KEY_PATTERN.test(value.trim())) {
    throw new Error('SF_INTEGRATION_MASTER_KEY must be an unpadded base64url-encoded 32-byte key.');
  }
  const key = Buffer.from(value.trim(), 'base64url');
  if (key.length !== KEY_BYTES) throw new Error('SF_INTEGRATION_MASTER_KEY must decode to exactly 32 bytes.');
  return key;
}

export function encryptIntegrationCredentials(credentials: unknown, key = readIntegrationMasterKey()): string {
  if (key.length !== KEY_BYTES) throw new Error('Integration encryption key must be exactly 32 bytes.');
  const normalized = normalizeIntegrationCredentials(credentials);
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b))));
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(canonical, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptIntegrationCredentials(envelope: string, key = readIntegrationMasterKey()): IntegrationCredentials {
  if (key.length !== KEY_BYTES) throw new Error('Integration encryption key must be exactly 32 bytes.');
  const [version, ivValue, tagValue, ciphertextValue, extra] = envelope.split('.');
  if (version !== ENVELOPE_VERSION || !ivValue || !tagValue || !ciphertextValue || extra !== undefined) {
    throw new Error('Encrypted integration credentials use an unsupported envelope.');
  }
  const iv = Buffer.from(ivValue, 'base64url');
  const tag = Buffer.from(tagValue, 'base64url');
  const ciphertext = Buffer.from(ciphertextValue, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0) throw new Error('Encrypted integration credentials are malformed.');

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return normalizeIntegrationCredentials(JSON.parse(plaintext));
  } catch {
    throw new Error('Encrypted integration credentials could not be authenticated.');
  }
}
