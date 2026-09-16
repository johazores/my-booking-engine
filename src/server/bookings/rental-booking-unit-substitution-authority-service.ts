import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { RentalAvailabilityIntegrityError } from '../inventory/rental-availability-domain.ts';
import { findOverdueRentalCustodyUnitIds } from '../inventory/rental-custody-availability.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  buildRentalBookingUnitSubstitutionAuthorityFingerprint,
  normalizeRentalBookingUnitSubstitutionSearch,
} from './rental-booking-unit-substitution-domain.ts';

const CANDIDATE_PAGE_SIZE = 50;

export type RentalBookingUnitSubstitutionBlocker =
  | 'NO_CHANGE'
  | 'TARGET_UNAVAILABLE'
  | 'INVENTORY_CONFLICT';

export class RentalBookingUnitSubstitutionUnavailableError extends Error {
  constructor(message = 'Rental booking is not available for unit substitution review in this organization.') {
    super(message);
    this.name = 'RentalBookingUnitSubstitutionUnavailableError';
  }
}

async function requireUnitSubstitutionPermissions(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  includeAvailability: boolean;
}>) {
  const checks = [
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'booking:manage',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'inventory:read',
    }),
  ];
  if (input.includeAvailability) {
    checks.push(requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'availability:read',
    }));
  }
  await Promise.all(checks);
}

const effectiveAllocationInclude = {
  unit: {
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      unitTypeId: true,
      locationId: true,
      unitType: { select: { id: true, code: true, name: true, status: true } },
      location: { select: { id: true, code: true, name: true, status: true } },
    },
  },
} as const;

function assertEffectiveAllocation(input: Readonly<{
  organizationId: string;
  booking: {
    id: string;
    unitId: string;
    unitTypeId: string;
    locationId: string;
    startsOn: Date;
    endsOn: Date;
    allocation: null | {
      organizationId: string;
      bookingId: string;
      unitId: string;
      startsOn: Date;
      endsOn: Date;
      unit: {
        id: string;
        code: string;
        name: string;
        status: string;
        unitTypeId: string;
        locationId: string | null;
        unitType: { id: string; code: string; name: string; status: string };
        location: null | { id: string; code: string; name: string; status: string };
      };
    };
  };
  latestReschedule: null | { targetStartsOn: Date; targetEndsOn: Date };
  latestSubstitution: null | { targetUnitId: string };
}>) {
  const startsOn = input.latestReschedule?.targetStartsOn ?? input.booking.startsOn;
  const endsOn = input.latestReschedule?.targetEndsOn ?? input.booking.endsOn;
  const sourceUnitId = input.latestSubstitution?.targetUnitId ?? input.booking.unitId;
  const allocation = input.booking.allocation;

  if (
    !allocation
    || allocation.organizationId !== input.organizationId
    || allocation.bookingId !== input.booking.id
    || allocation.unitId !== sourceUnitId
    || allocation.unit.id !== sourceUnitId
    || allocation.startsOn.getTime() !== startsOn.getTime()
    || allocation.endsOn.getTime() !== endsOn.getTime()
  ) {
    throw new RentalAvailabilityIntegrityError(
      'Rental unit substitution requires the exact effective physical-unit allocation.',
    );
  }

  if (
    allocation.unit.status !== 'ACTIVE'
    || allocation.unit.unitType.status !== 'ACTIVE'
    || !allocation.unit.location
    || allocation.unit.location.status !== 'ACTIVE'
    || allocation.unit.unitTypeId !== input.booking.unitTypeId
    || allocation.unit.unitType.id !== input.booking.unitTypeId
    || allocation.unit.locationId !== input.booking.locationId
    || allocation.unit.location.id !== input.booking.locationId
  ) {
    throw new RentalBookingUnitSubstitutionUnavailableError(
      'The effective physical unit is no longer active at the retained booking assignment.',
    );
  }

  return Object.freeze({ startsOn, endsOn, sourceUnitId, sourceUnit: allocation.unit });
}

export async function searchRentalBookingUnitSubstitutionCandidates(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  query?: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const query = normalizeRentalBookingUnitSubstitutionSearch(input.query);

  await requireUnitSubstitutionPermissions({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    includeAvailability: false,
  });

  return db.$transaction(async (transaction) => {
    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError(
        'Database time authority is unavailable for rental unit substitution candidates.',
      );
    }

    const booking = await transaction.rentalBooking.findFirst({
      where: {
        id: input.bookingId,
        organizationId: input.organizationId,
        status: 'CONFIRMED',
        cancelledAt: null,
        fulfillmentEvents: { none: { organizationId: input.organizationId } },
      },
      include: { allocation: { include: effectiveAllocationInclude } },
    });
    if (!booking) throw new RentalBookingUnitSubstitutionUnavailableError();

    const [latestReschedule, latestSubstitution] = await Promise.all([
      transaction.rentalBookingReschedule.findFirst({
        where: { organizationId: input.organizationId, bookingId: booking.id },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.rentalBookingUnitSubstitution.findFirst({
        where: { organizationId: input.organizationId, bookingId: booking.id },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const effective = assertEffectiveAllocation({
      organizationId: input.organizationId,
      booking,
      latestReschedule,
      latestSubstitution,
    });

    const overdueCustodyUnitIds = await findOverdueRentalCustodyUnitIds(transaction, {
      organizationId: input.organizationId,
      observedAt: databaseClock.now,
      unitTypeId: booking.unitTypeId,
      locationId: booking.locationId,
      excludeBookingId: booking.id,
    });

    const where = {
      organizationId: input.organizationId,
      status: 'ACTIVE' as const,
      unitTypeId: booking.unitTypeId,
      locationId: booking.locationId,
      id: {
        not: effective.sourceUnitId,
        ...(overdueCustodyUnitIds.length > 0 ? { notIn: overdueCustodyUnitIds } : {}),
      },
      unitType: {
        organizationId: input.organizationId,
        status: 'ACTIVE' as const,
      },
      location: {
        is: {
          organizationId: input.organizationId,
          status: 'ACTIVE' as const,
        },
      },
      ...(query
        ? {
            OR: [
              { code: { contains: query, mode: 'insensitive' as const } },
              { name: { contains: query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, candidates] = await Promise.all([
      transaction.rentalUnit.count({ where }),
      transaction.rentalUnit.findMany({
        where,
        orderBy: [{ name: 'asc' }, { code: 'asc' }, { id: 'asc' }],
        take: CANDIDATE_PAGE_SIZE,
        select: { id: true, code: true, name: true },
      }),
    ]);

    return Object.freeze({
      bookingId: booking.id,
      sourceUnitId: effective.sourceUnitId,
      unitTypeId: booking.unitTypeId,
      locationId: booking.locationId,
      startsOn: effective.startsOn,
      endsOn: effective.endsOn,
      query,
      total,
      limit: CANDIDATE_PAGE_SIZE,
      candidates: Object.freeze(candidates),
    });
  }, { isolationLevel: 'Serializable' });
}

export async function reviewRentalBookingUnitSubstitutionAuthority(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  targetUnitId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.targetUnitId, 'targetUnitId');

  await requireUnitSubstitutionPermissions({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    includeAvailability: true,
  });

  return db.$transaction(async (transaction) => {
    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError(
        'Database time authority is unavailable for rental unit substitution review.',
      );
    }

    const booking = await transaction.rentalBooking.findFirst({
      where: {
        id: input.bookingId,
        organizationId: input.organizationId,
        status: 'CONFIRMED',
        cancelledAt: null,
        fulfillmentEvents: { none: { organizationId: input.organizationId } },
      },
      include: { allocation: { include: effectiveAllocationInclude } },
    });
    if (!booking) throw new RentalBookingUnitSubstitutionUnavailableError();

    const [latestReschedule, latestSubstitution] = await Promise.all([
      transaction.rentalBookingReschedule.findFirst({
        where: { organizationId: input.organizationId, bookingId: booking.id },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.rentalBookingUnitSubstitution.findFirst({
        where: { organizationId: input.organizationId, bookingId: booking.id },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const effective = assertEffectiveAllocation({
      organizationId: input.organizationId,
      booking,
      latestReschedule,
      latestSubstitution,
    });
    const pricingFingerprint = latestReschedule?.targetPricingFingerprint ?? booking.pricingFingerprint;

    const targetUnit = await transaction.rentalUnit.findFirst({
      where: {
        id: input.targetUnitId,
        organizationId: input.organizationId,
        status: 'ACTIVE',
        unitTypeId: booking.unitTypeId,
        locationId: booking.locationId,
        unitType: {
          organizationId: input.organizationId,
          status: 'ACTIVE',
        },
        location: {
          is: {
            organizationId: input.organizationId,
            status: 'ACTIVE',
          },
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
        unitTypeId: true,
        locationId: true,
      },
    });

    let blocker: RentalBookingUnitSubstitutionBlocker | null = null;
    if (!targetUnit) blocker = 'TARGET_UNAVAILABLE';
    else if (targetUnit.id === effective.sourceUnitId) blocker = 'NO_CHANGE';
    else {
      const [blockOverlap, competingHold, bookingOverlap, overdueCustodyUnitIds] = await Promise.all([
        transaction.rentalAvailabilityBlock.findFirst({
          where: {
            organizationId: input.organizationId,
            unitId: targetUnit.id,
            startsOn: { lt: effective.endsOn },
            endsOn: { gt: effective.startsOn },
          },
          select: { id: true },
        }),
        transaction.rentalAvailabilityHold.findFirst({
          where: {
            organizationId: input.organizationId,
            unitId: targetUnit.id,
            status: 'ACTIVE',
            expiresAt: { gt: databaseClock.now },
            startsOn: { lt: effective.endsOn },
            endsOn: { gt: effective.startsOn },
          },
          select: { id: true },
        }),
        transaction.rentalBookingAllocation.findFirst({
          where: {
            organizationId: input.organizationId,
            unitId: targetUnit.id,
            bookingId: { not: booking.id },
            startsOn: { lt: effective.endsOn },
            endsOn: { gt: effective.startsOn },
            booking: {
              is: {
                organizationId: input.organizationId,
                status: { not: 'CANCELLED' },
              },
            },
          },
          select: { id: true },
        }),
        findOverdueRentalCustodyUnitIds(transaction, {
          organizationId: input.organizationId,
          observedAt: databaseClock.now,
          unitId: targetUnit.id,
          excludeBookingId: booking.id,
        }),
      ]);
      if (blockOverlap || competingHold || bookingOverlap || overdueCustodyUnitIds.length > 0) {
        blocker = 'INVENTORY_CONFLICT';
      }
    }

    const authorityFingerprint = targetUnit && blocker === null
      ? buildRentalBookingUnitSubstitutionAuthorityFingerprint({
          organizationId: input.organizationId,
          bookingId: booking.id,
          bookingUpdatedAt: booking.updatedAt,
          sourceUnitId: effective.sourceUnitId,
          targetUnitId: targetUnit.id,
          unitTypeId: booking.unitTypeId,
          locationId: booking.locationId,
          startsOn: effective.startsOn,
          endsOn: effective.endsOn,
          currency: booking.currency,
          totalMinor: booking.totalMinor,
          pricingFingerprint,
        })
      : null;

    return Object.freeze({
      ready: blocker === null,
      blocker,
      checkedAt: databaseClock.now,
      authorityFingerprint,
      booking: Object.freeze({
        id: booking.id,
        updatedAt: booking.updatedAt,
        startsOn: effective.startsOn,
        endsOn: effective.endsOn,
        currency: booking.currency,
        totalMinor: booking.totalMinor,
        pricingFingerprint,
      }),
      sourceUnit: Object.freeze({
        id: effective.sourceUnit.id,
        code: effective.sourceUnit.code,
        name: effective.sourceUnit.name,
      }),
      targetUnit: targetUnit ? Object.freeze({ id: targetUnit.id, code: targetUnit.code, name: targetUnit.name }) : null,
      unitType: Object.freeze({
        id: effective.sourceUnit.unitType.id,
        code: effective.sourceUnit.unitType.code,
        name: effective.sourceUnit.unitType.name,
      }),
      location: Object.freeze({
        id: effective.sourceUnit.location.id,
        code: effective.sourceUnit.location.code,
        name: effective.sourceUnit.location.name,
      }),
    });
  }, { isolationLevel: 'Serializable' });
}
