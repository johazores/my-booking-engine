import { createHash, createHmac } from 'node:crypto';

const PUBLIC_REQUEST_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MINIMUM_SECRET_BYTES = 32;

export class PublicBookingRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicBookingRequestValidationError';
  }
}

export function normalizePublicBookingRequestKey(value: unknown) {
  if (typeof value !== 'string' || !PUBLIC_REQUEST_KEY_PATTERN.test(value.trim())) {
    throw new PublicBookingRequestValidationError('Public booking request key must be a UUID v4.');
  }
  return value.trim().toLowerCase();
}

function derivePublicBookingIdempotencyKey(input: {
  secret: string;
  organizationId: string;
  requestKey: string;
  scope: 'hold' | 'confirmation' | 'payment-checkout';
}) {
  if (Buffer.byteLength(input.secret, 'utf8') < MINIMUM_SECRET_BYTES) {
    throw new PublicBookingRequestValidationError(`Public booking request secret must be at least ${MINIMUM_SECRET_BYTES} bytes.`);
  }
  if (!input.organizationId) throw new PublicBookingRequestValidationError('Organization is required.');
  const requestKey = normalizePublicBookingRequestKey(input.requestKey);
  const digest = createHmac('sha256', input.secret)
    .update(`public-booking-${input.scope}:${input.organizationId}:${requestKey}`)
    .digest('hex');
  return `public:${digest}`;
}

export function derivePublicBookingHoldIdempotencyKey(input: {
  secret: string;
  organizationId: string;
  requestKey: string;
}) {
  return derivePublicBookingIdempotencyKey({ ...input, scope: 'hold' });
}

export function derivePublicBookingConfirmationIdempotencyKey(input: {
  secret: string;
  organizationId: string;
  requestKey: string;
}) {
  return derivePublicBookingIdempotencyKey({ ...input, scope: 'confirmation' });
}

export function derivePublicBookingCheckoutIdempotencyKey(input: {
  secret: string;
  organizationId: string;
  requestKey: string;
}) {
  return derivePublicBookingIdempotencyKey({ ...input, scope: 'payment-checkout' });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function createPublicBookingRequestFingerprint(value: unknown) {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}
