import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { RentalAvailabilityIntegrityError } from '../inventory/rental-availability-domain.ts';
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
    const booking = await transaction.rentalBooking.findFirst({
      where: {
        id: input.bookingId,
        organizationId: input.organizationId,
        status: 'CONFIRMED',
        cancelledAt: null,
      },
      include: { allocation: true },
    });
    if (!booking) throw new RentalBookingUnitSubstitutionUnavailableError();

    const latestReschedule = await transaction.rentalBookingReschedule.findFirst({
      where: { organizationId: input.organizationId, bookingId: booking.id },
      orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    const startsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
    const endsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
    if (
      !booking.allocation
      || booking.allocation.organizationId !== input.organizationId
      || booking.allocation.bookingId !== booking.id
      || booking.allocation.unitId !== booking.unitId
      || booking.allocation.startsOn.getTime() !== startsOn.getTime()
      || booking.allocation.endsOn.getTime() !== endsOn.getTime()
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Rental unit substitution requires the exact effective physical-unit allocation.',
      );
    }

    const where = {
      organizationId: input.organizationId,
      status: 'ACTIVE' as const,
      unitTypeId: booking.unitTypeId,
      locationId: booking.locationId,
      id: { not: booking.unitId },
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
      sourceUnitId: booking.unitId,
      unitTypeId: booking.unitTypeId,
      locationId: booking.locationId,
      startsOn,
      endsOn,
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
      },
      include: {
        allocation: true,
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
      },
    });
    if (!booking) throw new RentalBookingUnitSubstitutionUnavailableError();

    const latestReschedule = await transaction.rentalBookingReschedule.findFirst({
      where: { organizationId: input.organizationId, bookingId: booking.id },
      orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    const startsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
    const endsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
    const pricingFingerprint = latestReschedule?.targetPricingFingerprint ?? booking.pricingFingerprint;

    if (
      !booking.allocation
      || booking.allocation.organizationId !== input.organizationId
      || booking.allocation.bookingId !== booking.id
      || booking.allocation.unitId !== booking.unitId
      || booking.allocation.startsOn.getTime() !== startsOn.getTime()
      || booking.allocation.endsOn.getTime() !== endsOn.getTime()
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Rental unit substitution review requires the exact effective physical-unit allocation.',
      );
    }
    if (
      booking.unit.status !== 'ACTIVE'
      || booking.unit.unitType.status !== 'ACTIVE'
      || !booking.unit.location
      || booking.unit.location.status !== 'ACTIVE'
      || booking.unit.unitTypeId !== booking.unit.unitType.id
      || booking.unit.locationId !== booking.unit.location.id
      || booking.unitId !== booking.unit.id
      || booking.unitTypeId !== booking.unit.unitType.id
      || booking.locationId !== booking.unit.location.id
    ) {
      throw new RentalBookingUnitSubstitutionUnavailableError(
        'The booked physical unit is no longer active at its retained operating assignment.',
      );
    }

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
    if (!targetUnit) {
      blocker = 'TARGET_UNAVAILABLE';
    } else if (targetUnit.id === booking.unitId) {
      blocker = 'NO_CHANGE';
    } else {
      const [blockOverlap, competingHold, bookingOverlap] = await Promise.all([
        transaction.rentalAvailabilityBlock.findFirst({
          where: {
            organizationId: input.organizationId,
            unitId: targetUnit.id,
            startsOn: { lt: endsOn },
            endsOn: { gt: startsOn },
          },
          select: { id: true },
        }),
        transaction.rentalAvailabilityHold.findFirst({
          where: {
            organizationId: input.organizationId,
            unitId: targetUnit.id,
            status: 'ACTIVE',
            expiresAt: { gt: databaseClock.now },
            startsOn: { lt: endsOn },
            endsOn: { gt: startsOn },
          },
          select: { id: true },
        }),
        transaction.rentalBookingAllocation.findFirst({
          where: {
            organizationId: input.organizationId,
            unitId: targetUnit.id,
            startsOn: { lt: endsOn },
            endsOn: { gt: startsOn },
            booking: {
              is: {
                organizationId: input.organizationId,
                status: { not: 'CANCELLED' },
              },
            },
          },
          select: { id: true },
        }),
      ]);
      if (blockOverlap || competingHold || bookingOverlap) {
        blocker = 'INVENTORY_CONFLICT';
      }
    }

    const authorityFingerprint = targetUnit && blocker === null
      ? buildRentalBookingUnitSubstitutionAuthorityFingerprint({
          organizationId: input.organizationId,
          bookingId: booking.id,
          bookingUpdatedAt: booking.updatedAt,
          sourceUnitId: booking.unitId,
          targetUnitId: targetUnit.id,
          unitTypeId: booking.unitTypeId,
          locationId: booking.locationId,
          startsOn,
          endsOn,
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
        startsOn,
        endsOn,
        currency: booking.currency,
        totalMinor: booking.totalMinor,
        pricingFingerprint,
      }),
      sourceUnit: Object.freeze({
        id: booking.unit.id,
        code: booking.unit.code,
        name: booking.unit.name,
      }),
      targetUnit: targetUnit
        ? Object.freeze({ id: targetUnit.id, code: targetUnit.code, name: targetUnit.name })
        : null,
      unitType: Object.freeze({
        id: booking.unit.unitType.id,
        code: booking.unit.unitType.code,
        name: booking.unit.unitType.name,
      }),
      location: Object.freeze({
        id: booking.unit.location.id,
        code: booking.unit.location.code,
        name: booking.unit.location.name,
      }),
    });
  }, { isolationLevel: 'Serializable' });
}
