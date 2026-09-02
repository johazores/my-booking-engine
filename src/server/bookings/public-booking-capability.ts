import { createHmac, timingSafeEqual } from 'node:crypto';

const PUBLIC_BOOKING_CAPABILITY_VERSION = 1;
const PUBLIC_BOOKING_CAPABILITY_SCOPE = 'hold:manage' as const;
const MINIMUM_SECRET_BYTES = 32;

export class PublicBookingCapabilityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicBookingCapabilityConfigurationError';
  }
}

export type PublicBookingHoldCapability = {
  version: 1;
  scope: typeof PUBLIC_BOOKING_CAPABILITY_SCOPE;
  organizationId: string;
  holdId: string;
  expiresAt: Date;
};

type SerializedCapability = {
  v: 1;
  s: typeof PUBLIC_BOOKING_CAPABILITY_SCOPE;
  o: string;
  h: string;
  e: number;
};

function assertSecret(secret: string) {
  if (Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES) {
    throw new PublicBookingCapabilityConfigurationError(
      `Public booking capability secret must be at least ${MINIMUM_SECRET_BYTES} bytes.`,
    );
  }
}

function signPayload(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function parsePayload(encodedPayload: string): SerializedCapability | null {
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<SerializedCapability>;
    if (
      parsed.v !== PUBLIC_BOOKING_CAPABILITY_VERSION
      || parsed.s !== PUBLIC_BOOKING_CAPABILITY_SCOPE
      || typeof parsed.o !== 'string'
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
  holdId: string;
  expiresAt: Date;
}) {
  assertSecret(input.secret);
  if (!input.organizationId || !input.holdId || Number.isNaN(input.expiresAt.getTime())) {
    throw new TypeError('Public booking capability requires organization, hold, and expiry values.');
  }

  const serialized: SerializedCapability = {
    v: PUBLIC_BOOKING_CAPABILITY_VERSION,
    s: PUBLIC_BOOKING_CAPABILITY_SCOPE,
    o: input.organizationId,
    h: input.holdId,
    e: input.expiresAt.getTime(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(serialized), 'utf8').toString('base64url');
  return `${encodedPayload}.${signPayload(encodedPayload, input.secret)}`;
}

export function verifyPublicBookingHoldCapability(input: {
  secret: string;
  token: string;
  expectedOrganizationId?: string;
  now?: Date;
}): PublicBookingHoldCapability | null {
  assertSecret(input.secret);
  const [encodedPayload, suppliedSignature, extra] = input.token.split('.');
  if (!encodedPayload || !suppliedSignature || extra !== undefined) return null;

  const expectedSignature = signPayload(encodedPayload, input.secret);
  const suppliedBytes = Buffer.from(suppliedSignature, 'utf8');
  const expectedBytes = Buffer.from(expectedSignature, 'utf8');
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return null;

  const payload = parsePayload(encodedPayload);
  if (!payload) return null;
  if (input.expectedOrganizationId && payload.o !== input.expectedOrganizationId) return null;

  const now = input.now ?? new Date();
  if (payload.e <= now.getTime()) return null;

  return {
    version: PUBLIC_BOOKING_CAPABILITY_VERSION,
    scope: PUBLIC_BOOKING_CAPABILITY_SCOPE,
    organizationId: payload.o,
    holdId: payload.h,
    expiresAt: new Date(payload.e),
  };
}
