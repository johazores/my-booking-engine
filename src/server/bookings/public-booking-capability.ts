import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const HOLD_CAPABILITY_VERSION = 2;
const BOOKING_CAPABILITY_VERSION = 3;
const HOLD_SCOPE = 'hold:manage' as const;
const BOOKING_SCOPE = 'booking:manage' as const;
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
  scope: typeof HOLD_SCOPE;
  organizationId: string;
  principalId: string;
  holdId: string;
  expiresAt: Date;
};

export type PublicBookingBookingCapability = {
  version: 3;
  scope: typeof BOOKING_SCOPE;
  organizationId: string;
  principalId: string;
  bookingId: string;
  expiresAt: Date;
};

type SerializedHoldCapability = { v: 2; s: typeof HOLD_SCOPE; o: string; p: string; h: string; e: number };
type SerializedBookingCapability = { v: 3; s: typeof BOOKING_SCOPE; o: string; p: string; b: string; e: number };

function capabilityKey(secret: string) {
  if (Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES) {
    throw new PublicBookingCapabilityConfigurationError(`Public booking capability secret must be at least ${MINIMUM_SECRET_BYTES} bytes.`);
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

function encryptCapability(secret: string, version: 'v2' | 'v3', payload: object) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', capabilityKey(secret), iv, { authTagLength: AUTH_TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return `${version}.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

function decryptCapability(secret: string, token: string, expectedVersion: 'v2' | 'v3') {
  const [version, encodedIv, encodedCiphertext, encodedTag, extra] = token.split('.');
  if (version !== expectedVersion || !encodedIv || !encodedCiphertext || !encodedTag || extra !== undefined) return null;
  try {
    const iv = Buffer.from(encodedIv, 'base64url');
    const ciphertext = Buffer.from(encodedCiphertext, 'base64url');
    const tag = Buffer.from(encodedTag, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) return null;
    const decipher = createDecipheriv('aes-256-gcm', capabilityKey(secret), iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function issuePublicBookingHoldCapability(input: { secret: string; organizationId: string; principalId: string; holdId: string; expiresAt: Date }) {
  if (!input.organizationId || !input.principalId || !input.holdId || Number.isNaN(input.expiresAt.getTime())) {
    throw new TypeError('Public booking capability requires organization, principal, hold, and expiry values.');
  }
  const payload: SerializedHoldCapability = { v: HOLD_CAPABILITY_VERSION, s: HOLD_SCOPE, o: input.organizationId, p: input.principalId, h: input.holdId, e: input.expiresAt.getTime() };
  return encryptCapability(input.secret, 'v2', payload);
}

export function verifyPublicBookingHoldCapability(input: { secret: string; token: string; expectedOrganizationId?: string; expectedPrincipalId?: string; now?: Date }): PublicBookingHoldCapability | null {
  const payload = decryptCapability(input.secret, input.token, 'v2');
  if (!payload || payload.v !== HOLD_CAPABILITY_VERSION || payload.s !== HOLD_SCOPE || typeof payload.o !== 'string' || typeof payload.p !== 'string' || typeof payload.h !== 'string' || typeof payload.e !== 'number' || !Number.isSafeInteger(payload.e)) return null;
  if (input.expectedOrganizationId && payload.o !== input.expectedOrganizationId) return null;
  if (input.expectedPrincipalId && payload.p !== input.expectedPrincipalId) return null;
  const now = input.now ?? new Date();
  if (payload.e <= now.getTime()) return null;
  return { version: 2, scope: HOLD_SCOPE, organizationId: payload.o, principalId: payload.p, holdId: payload.h, expiresAt: new Date(payload.e) };
}

export function issuePublicBookingBookingCapability(input: { secret: string; organizationId: string; principalId: string; bookingId: string; expiresAt: Date }) {
  if (!input.organizationId || !input.principalId || !input.bookingId || Number.isNaN(input.expiresAt.getTime())) {
    throw new TypeError('Public booking capability requires organization, principal, booking, and expiry values.');
  }
  const payload: SerializedBookingCapability = { v: BOOKING_CAPABILITY_VERSION, s: BOOKING_SCOPE, o: input.organizationId, p: input.principalId, b: input.bookingId, e: input.expiresAt.getTime() };
  return encryptCapability(input.secret, 'v3', payload);
}

export function verifyPublicBookingBookingCapability(input: { secret: string; token: string; expectedOrganizationId?: string; expectedPrincipalId?: string; now?: Date }): PublicBookingBookingCapability | null {
  const payload = decryptCapability(input.secret, input.token, 'v3');
  if (!payload || payload.v !== BOOKING_CAPABILITY_VERSION || payload.s !== BOOKING_SCOPE || typeof payload.o !== 'string' || typeof payload.p !== 'string' || typeof payload.b !== 'string' || typeof payload.e !== 'number' || !Number.isSafeInteger(payload.e)) return null;
  if (input.expectedOrganizationId && payload.o !== input.expectedOrganizationId) return null;
  if (input.expectedPrincipalId && payload.p !== input.expectedPrincipalId) return null;
  const now = input.now ?? new Date();
  if (payload.e <= now.getTime()) return null;
  return { version: 3, scope: BOOKING_SCOPE, organizationId: payload.o, principalId: payload.p, bookingId: payload.b, expiresAt: new Date(payload.e) };
}
