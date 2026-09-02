import type { AvailabilityRequestInput } from '../availability/availability-domain.ts';
import {
  AvailabilityHoldConflictError,
  AvailabilityHoldUnavailableError,
  createHospitalityAvailabilityHoldInTransaction,
  releaseHospitalityAvailabilityHoldInTransaction,
} from '../availability/hospitality-availability-hold-core.ts';
import { readPublicOrganizationBrandingBySlug } from '../branding/branding-service.ts';
import { db } from '../database.ts';
import {
  PublicBookingCapabilityConfigurationError,
  issuePublicBookingHoldCapability,
  verifyPublicBookingHoldCapability,
} from './public-booking-capability.ts';
import { enforcePublicBookingHoldCreationLimit } from './public-booking-abuse-control.ts';
import { derivePublicBookingHoldIdempotencyKey } from './public-booking-request-domain.ts';
import { PublicHospitalityBookingUnavailableError } from './public-hospitality-search-service.ts';

const PUBLIC_HOLD_MINUTES = 15;

export class PublicHospitalityHoldAuthorizationError extends Error {
  constructor(message = 'Public booking hold authorization is invalid or expired.') {
    super(message);
    this.name = 'PublicHospitalityHoldAuthorizationError';
  }
}

export class PublicHospitalityHoldConflictError extends Error {
  constructor(message = 'Public booking hold request conflicts with existing ownership.') {
    super(message);
    this.name = 'PublicHospitalityHoldConflictError';
  }
}

function publicBookingSecret() {
  const secret = process.env.SF_PUBLIC_BOOKING_SECRET?.trim();
  if (!secret) {
    throw new PublicBookingCapabilityConfigurationError('SF_PUBLIC_BOOKING_SECRET is required for public booking writes.');
  }
  return secret;
}

function serializePublicHold(hold: {
  arrivalDate: Date;
  departureDate: Date;
  quantity: number;
  expiresAt: Date;
  status: string;
}) {
  return {
    arrivalDate: hold.arrivalDate.toISOString().slice(0, 10),
    departureDate: hold.departureDate.toISOString().slice(0, 10),
    quantity: hold.quantity,
    expiresAt: hold.expiresAt.toISOString(),
    status: hold.status,
  };
}

export async function createPublicHospitalityAvailabilityHold(input: {
  organizationSlug: string;
  requestKey: string;
  request: AvailabilityRequestInput;
  now?: Date;
}) {
  const branding = await readPublicOrganizationBrandingBySlug(input.organizationSlug);
  if (!branding) throw new PublicHospitalityBookingUnavailableError();
  const now = input.now ?? new Date();
  const secret = publicBookingSecret();
  const idempotencyKey = derivePublicBookingHoldIdempotencyKey({
    secret,
    organizationId: branding.id,
    requestKey: input.requestKey,
  });

  const result = await db.$transaction(async (transaction) => {
    await enforcePublicBookingHoldCreationLimit({
      transaction,
      organizationId: branding.id,
      idempotencyKey,
      quantity: input.request.quantity,
      now,
    });

    const holdResult = await createHospitalityAvailabilityHoldInTransaction({
      transaction,
      organizationId: branding.id,
      hold: {
        idempotencyKey,
        expiresInMinutes: PUBLIC_HOLD_MINUTES,
        request: input.request,
      },
      now,
    });

    if (!holdResult.created) {
      const ownership = await transaction.publicBookingHoldOwnership.findUnique({
        where: {
          organizationId_holdId: {
            organizationId: branding.id,
            holdId: holdResult.hold.id,
          },
        },
      });
      if (!ownership) throw new PublicHospitalityHoldConflictError();
      const principal = await transaction.publicBookingPrincipal.findFirst({
        where: {
          id: ownership.principalId,
          organizationId: branding.id,
          expiresAt: { gt: now },
        },
      });
      if (!principal || holdResult.hold.status !== 'ACTIVE' || holdResult.hold.expiresAt <= now) {
        throw new AvailabilityHoldUnavailableError('The previous public booking hold has expired or ended. Start a new request.');
      }
      return { hold: holdResult.hold, principal };
    }

    const principal = await transaction.publicBookingPrincipal.create({
      data: {
        organizationId: branding.id,
        expiresAt: holdResult.hold.expiresAt,
      },
    });
    await transaction.publicBookingHoldOwnership.create({
      data: {
        organizationId: branding.id,
        holdId: holdResult.hold.id,
        principalId: principal.id,
      },
    });
    await transaction.publicBookingAuditEvent.create({
      data: {
        organizationId: branding.id,
        actorPrincipalId: principal.id,
        action: 'public-booking.hold.created',
        resourceType: 'hospitality-availability-hold',
        resourceId: holdResult.hold.id,
        afterData: {
          quantity: holdResult.hold.quantity,
          expiresAt: holdResult.hold.expiresAt.toISOString(),
        },
      },
    });
    return { hold: holdResult.hold, principal };
  }, { isolationLevel: 'Serializable' });

  return {
    hold: serializePublicHold(result.hold),
    capability: issuePublicBookingHoldCapability({
      secret,
      organizationId: branding.id,
      principalId: result.principal.id,
      holdId: result.hold.id,
      expiresAt: result.hold.expiresAt,
    }),
  };
}

export async function releasePublicHospitalityAvailabilityHold(input: {
  organizationSlug: string;
  capability: string;
  now?: Date;
}) {
  const branding = await readPublicOrganizationBrandingBySlug(input.organizationSlug);
  if (!branding) throw new PublicHospitalityBookingUnavailableError();
  const now = input.now ?? new Date();
  const secret = publicBookingSecret();
  const capability = verifyPublicBookingHoldCapability({
    secret,
    token: input.capability,
    expectedOrganizationId: branding.id,
    now,
  });
  if (!capability) throw new PublicHospitalityHoldAuthorizationError();

  const hold = await db.$transaction(async (transaction) => {
    const ownership = await transaction.publicBookingHoldOwnership.findUnique({
      where: {
        organizationId_holdId: {
          organizationId: branding.id,
          holdId: capability.holdId,
        },
      },
    });
    if (!ownership || ownership.principalId !== capability.principalId) {
      throw new PublicHospitalityHoldAuthorizationError();
    }
    const principal = await transaction.publicBookingPrincipal.findFirst({
      where: {
        id: capability.principalId,
        organizationId: branding.id,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (!principal) throw new PublicHospitalityHoldAuthorizationError();

    const releaseResult = await releaseHospitalityAvailabilityHoldInTransaction({
      transaction,
      organizationId: branding.id,
      holdId: capability.holdId,
      now,
    });
    if (releaseResult.changed) {
      await transaction.publicBookingAuditEvent.create({
        data: {
          organizationId: branding.id,
          actorPrincipalId: capability.principalId,
          action: releaseResult.hold.status === 'EXPIRED' ? 'public-booking.hold.expired' : 'public-booking.hold.released',
          resourceType: 'hospitality-availability-hold',
          resourceId: releaseResult.hold.id,
          beforeData: { status: releaseResult.previousStatus },
          afterData: { status: releaseResult.hold.status, endedAt: now.toISOString() },
        },
      });
    }
    return releaseResult.hold;
  }, { isolationLevel: 'Serializable' });

  return { hold: serializePublicHold(hold) };
}

export { AvailabilityHoldConflictError, AvailabilityHoldUnavailableError };
