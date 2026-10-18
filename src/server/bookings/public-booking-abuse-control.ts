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

export class PublicBookingHoldQuantityValidationError extends Error {
  constructor() {
    super(`Public booking requests support at most ${PUBLIC_BOOKING_MAX_ROOMS_PER_HOLD} rooms per hold.`);
    this.name = 'PublicBookingHoldQuantityValidationError';
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

  // New requests are subject to the anonymous quantity limit. Reused keys must
  // reach the canonical payload comparison, which rejects changed retries as conflicts.
  const quantity = Number(input.quantity);
  if (Number.isInteger(quantity) && quantity > PUBLIC_BOOKING_MAX_ROOMS_PER_HOLD) {
    throw new PublicBookingHoldQuantityValidationError();
  }

  const active = await input.transaction.publicBookingPrincipal.aggregate({
    where: {
      organizationId: input.organizationId,
      expiresAt: { gt: input.now },
      // Settled and cancelled bookings must not consume the anonymous ingress
      // quota for the full 24-hour customer recovery credential lifetime.
      // Unconfirmed/released holds still count until their short principal expiry.
      OR: [
        { bookingOwnerships: { none: {} } },
        {
          bookingOwnerships: {
            some: {
              booking: {
                status: { not: 'CANCELLED' },
                paymentStatus: { in: ['UNPAID', 'AUTHORIZED', 'FAILED'] },
              },
            },
          },
        },
      ],
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
