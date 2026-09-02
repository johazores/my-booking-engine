import type { Prisma } from '../../generated/prisma/client.ts';

export const PUBLIC_BOOKING_MAX_ACTIVE_HOLDS_PER_ORGANIZATION = 24;
export const PUBLIC_BOOKING_MAX_ROOMS_PER_HOLD = 4;

export class PublicBookingAbuseLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Public booking hold capacity is temporarily limited. Try again shortly.');
    this.name = 'PublicBookingAbuseLimitError';
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

function ingressLockKey(organizationId: string) {
  return `public-booking-ingress:${organizationId}`;
}

export async function enforcePublicBookingHoldCreationLimit(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  idempotencyKey: string;
  quantity: unknown;
  now: Date;
}) {
  const quantity = Number(input.quantity);
  if (Number.isInteger(quantity) && quantity > PUBLIC_BOOKING_MAX_ROOMS_PER_HOLD) {
    throw new RangeError(`Public booking requests support at most ${PUBLIC_BOOKING_MAX_ROOMS_PER_HOLD} rooms per hold.`);
  }

  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ingressLockKey(input.organizationId)}, 0))`;

  // Exact and changed retries must reach the canonical idempotency comparison even
  // when the tenant is at its anonymous-write ceiling.
  const existing = await input.transaction.hospitalityAvailabilityHold.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: { id: true },
  });
  if (existing) return;

  const active = await input.transaction.publicBookingPrincipal.aggregate({
    where: {
      organizationId: input.organizationId,
      expiresAt: { gt: input.now },
    },
    _count: { _all: true },
    _min: { expiresAt: true },
  });

  if (active._count._all < PUBLIC_BOOKING_MAX_ACTIVE_HOLDS_PER_ORGANIZATION) return;

  const earliestExpiry = active._min.expiresAt;
  const retryAfterSeconds = earliestExpiry
    ? (earliestExpiry.getTime() - input.now.getTime()) / 1000
    : 60;
  throw new PublicBookingAbuseLimitError(retryAfterSeconds);
}
