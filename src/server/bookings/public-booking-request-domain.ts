import { createHmac } from 'node:crypto';

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

export function derivePublicBookingHoldIdempotencyKey(input: {
  secret: string;
  organizationId: string;
  requestKey: string;
}) {
  if (Buffer.byteLength(input.secret, 'utf8') < MINIMUM_SECRET_BYTES) {
    throw new PublicBookingRequestValidationError(`Public booking request secret must be at least ${MINIMUM_SECRET_BYTES} bytes.`);
  }
  if (!input.organizationId) throw new PublicBookingRequestValidationError('Organization is required.');
  const requestKey = normalizePublicBookingRequestKey(input.requestKey);
  const digest = createHmac('sha256', input.secret)
    .update(`public-booking-hold:${input.organizationId}:${requestKey}`)
    .digest('hex');
  return `public:${digest}`;
}
