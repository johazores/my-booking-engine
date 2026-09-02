import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PUBLIC_BOOKING_CAPABILITY_VERSION = 2;
const PUBLIC_BOOKING_CAPABILITY_SCOPE = 'hold:manage' as const;
const MINIMUM_SECRET_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export class PublicBookingCapabilityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicBookingCapabilityConfigurationError';
  }
}

export type PublicBookingHoldCapability = {
  version: 2;
  scope: typeof PUBLIC_BOOKING_CAPABILITY_SCOPE;
  organizationId: string;
  principalId: string;
  holdId: string;
  expiresAt: Date;
};

type SerializedCapability = {
  v: 2;
  s: typeof PUBLIC_BOOKING_CAPABILITY_SCOPE;
  o: string;
  p: string;
  h: string;
  e: number;
};

function capabilityKey(secret: string) {
  if (Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES) {
    throw new PublicBookingCapabilityConfigurationError(
      `Public booking capability secret must be at least ${MINIMUM_SECRET_BYTES} bytes.`,
    );
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

function parsePayload(value: string): SerializedCapability | null {
  try {
    const parsed = JSON.parse(value) as Partial<SerializedCapability>;
    if (
      parsed.v !== PUBLIC_BOOKING_CAPABILITY_VERSION
      || parsed.s !== PUBLIC_BOOKING_CAPABILITY_SCOPE
      || typeof parsed.o !== 'string'
      || typeof parsed.p !== 'string'
      || typeof parsed.h !== 'string'
      || typeof parsed.e !== 'number'
      || !Number.isSafeInteger(parsed.e)
      || parsed.e <= 0
    ) return null;
    return parsed as SerializedCapability;
  } catch {
    return null;
  }
}

export function issuePublicBookingHoldCapability(input: {
  secret: string;
  organizationId: string;
  principalId: string;
  holdId: string;
  expiresAt: Date;
}) {
  const key = capabilityKey(input.secret);
  if (!input.organizationId || !input.principalId || !input.holdId || Number.isNaN(input.expiresAt.getTime())) {
    throw new TypeError('Public booking capability requires organization, principal, hold, and expiry values.');
  }

  const serialized: SerializedCapability = {
    v: PUBLIC_BOOKING_CAPABILITY_VERSION,
    s: PUBLIC_BOOKING_CAPABILITY_SCOPE,
    o: input.organizationId,
    p: input.principalId,
    h: input.holdId,
    e: input.expiresAt.getTime(),
  };
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(serialized), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v2.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`;
}

export function verifyPublicBookingHoldCapability(input: {
  secret: string;
  token: string;
  expectedOrganizationId?: string;
  expectedPrincipalId?: string;
  now?: Date;
}): PublicBookingHoldCapability | null {
  const key = capabilityKey(input.secret);
  const [version, encodedIv, encodedCiphertext, encodedTag, extra] = input.token.split('.');
  if (version !== 'v2' || !encodedIv || !encodedCiphertext || !encodedTag || extra !== undefined) return null;

  try {
    const iv = Buffer.from(encodedIv, 'base64url');
    const ciphertext = Buffer.from(encodedCiphertext, 'base64url');
    const tag = Buffer.from(encodedTag, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) return null;

    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const payload = parsePayload(plaintext);
    if (!payload) return null;
    if (input.expectedOrganizationId && payload.o !== input.expectedOrganizationId) return null;
    if (input.expectedPrincipalId && payload.p !== input.expectedPrincipalId) return null;

    const now = input.now ?? new Date();
    if (payload.e <= now.getTime()) return null;

    return {
      version: PUBLIC_BOOKING_CAPABILITY_VERSION,
      scope: PUBLIC_BOOKING_CAPABILITY_SCOPE,
      organizationId: payload.o,
      principalId: payload.p,
      holdId: payload.h,
      expiresAt: new Date(payload.e),
    };
  } catch {
    return null;
  }
}
