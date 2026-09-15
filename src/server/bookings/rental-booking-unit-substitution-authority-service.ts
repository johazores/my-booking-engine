import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { RentalAvailabilityIntegrityError } from '../inventory/rental-availability-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  buildRentalBookingUnitSubstitutionAuthorityFingerprint,
  normalizeRentalBookingUnitSubstitutionReviewInput,
  type RentalBookingUnitSubstitutionReviewInput,
} from './rental-booking-unit-substitution-domain.ts';

export type RentalBookingUnitSubstitutionBlocker =
  | 'NO_CHANGE'
  | 'INCOMPATIBLE_UNIT'
  | 'INVENTORY_CONFLICT';

export class RentalBookingUnitSubstitutionUnavailableError extends Error {
  constructor(message = 'Rental booking is not available for unit substitution in this organization.') {
    super(message);
    this.name = 'RentalBookingUnitSubstitutionUnavailableError';
  }
}

async function requireReviewPermissions(input: Readonly<{
  organizationId: string;
  actorUserId: string;
}>) {
  await Promise.all([
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'booking:manage',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'availability:read',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'inventory:read',
    }),
  ]);
}

export async function listRentalBookingUnitSubstitutionCandidates(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireReviewPermissions(input);

  const booking = await db.rentalBooking.findFirst({
    where: {
      id: input.bookingId,
      organizationId: input.organizationId,
      status: 'CONFIRMED',
      cancelledAt: null,
    },
    include: { allocation: true },
  });
  if (!booking?.allocation) throw new RentalBookingUnitSubstitutionUnavailableError();

  const units = await db.rentalUnit.findMany({
    where: {
      organizationId: input.organizationId,
      unitTypeId: booking.unitTypeId,
      locationId: booking.locationId,
      status: 'ACTIVE',
      id: { not: booking.allocation.unitId },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 100,
    select: { id: true, code: true, name: true, status: true },
  });

  return Object.freeze({
    sourceUnitId: booking.allocation.unitId,
    units: units.map((unit) => Object.freeze(unit)),
  });
}

export async function reviewRentalBookingUnitSubstitutionAuthority(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  target: RentalBookingUnitSubstitutionReviewInput;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const targetInput = normalizeRentalBookingUnitSubstitutionReviewInput(input.target);
  await requireReviewPermissions(input);

  return db.$transaction(async (transaction) => {
    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError(
        'Database time authority is unavailable for rental unit substitution review.',
      );
    }

    const [booking, latestReschedule, latestSubstitution, targetUnit] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: {
          id: input.bookingId,
          organizationId: input.organizationId,
          status: 'CONFIRMED',
          cancelledAt: null,
        },
        include: {
          allocation: {
            include: {
              unit: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  status: true,
                  unitTypeId: true,
                  locationId: true,
                },
              },
            },
          },
        },
      }),
      transaction.rentalBookingReschedule.findFirst({
        where: { organizationId: input.organizationId, bookingId: input.bookingId },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.rentalBookingUnitSubstitution.findFirst({
        where: { organizationId: input.organizationId, bookingId: input.bookingId },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.rentalUnit.findFirst({
        where: { id: targetInput.targetUnitId, organizationId: input.organizationId },
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          unitTypeId: true,
          locationId: true,
          unitType: { select: { status: true } },
          location: { select: { status: true } },
        },
      }),
    ]);
    if (!booking?.allocation) throw new RentalBookingUnitSubstitutionUnavailableError();

    const effectiveStartsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
    const effectiveEndsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
    const effectivePricingFingerprint =
      latestReschedule?.targetPricingFingerprint ?? booking.pricingFingerprint;
    const expectedSourceUnitId = latestSubstitution?.targetUnitId ?? booking.unitId;

    if (
      booking.allocation.organizationId !== input.organizationId
      || booking.allocation.bookingId !== booking.id
      || booking.allocation.unitId !== expectedSourceUnitId
      || booking.allocation.startsOn.getTime() !== effectiveStartsOn.getTime()
      || booking.allocation.endsOn.getTime() !== effectiveEndsOn.getTime()
      || booking.allocation.unit.id !== booking.allocation.unitId
      || booking.allocation.unit.unitTypeId !== booking.unitTypeId
      || booking.allocation.unit.locationId !== booking.locationId
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Rental unit substitution review requires the exact effective physical-unit allocation.',
      );
    }
    if (booking.allocation.unit.status !== 'ACTIVE') {
      throw new RentalBookingUnitSubstitutionUnavailableError(
        'The currently allocated physical unit is no longer active.',
      );
    }

    let blocker: RentalBookingUnitSubstitutionBlocker | null = null;
    if (targetInput.targetUnitId === booking.allocation.unitId) {
      blocker = 'NO_CHANGE';
    } else if (
      !targetUnit
      || targetUnit.status !== 'ACTIVE'
      || targetUnit.unitType.status !== 'ACTIVE'
      || !targetUnit.location
      || targetUnit.location.status !== 'ACTIVE'
      || targetUnit.unitTypeId !== booking.unitTypeId
      || targetUnit.locationId !== booking.locationId
    ) {
      blocker = 'INCOMPATIBLE_UNIT';
    }

    if (blocker === null && targetUnit) {
      const [blockOverlap, competingHold, bookingOverlap] = await Promise.all([
        transaction.rentalAvailabilityBlock.findFirst({
          where: {
            organizationId: input.organizationId,
            unitId: targetUnit.id,
            startsOn: { lt: effectiveEndsOn },
            endsOn: { gt: effectiveStartsOn },
          },
          select: { id: true },
        }),
        transaction.rentalAvailabilityHold.findFirst({
          where: {
            organizationId: input.organizationId,
            unitId: targetUnit.id,
            status: 'ACTIVE',
            expiresAt: { gt: databaseClock.now },
            startsOn: { lt: effectiveEndsOn },
            endsOn: { gt: effectiveStartsOn },
          },
          select: { id: true },
        }),
        transaction.rentalBookingAllocation.findFirst({
          where: {
            organizationId: input.organizationId,
            unitId: targetUnit.id,
            bookingId: { not: booking.id },
            startsOn: { lt: effectiveEndsOn },
            endsOn: { gt: effectiveStartsOn },
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
      if (blockOverlap || competingHold || bookingOverlap) blocker = 'INVENTORY_CONFLICT';
    }

    const authorityFingerprint = blocker === null && targetUnit
      ? buildRentalBookingUnitSubstitutionAuthorityFingerprint({
          organizationId: input.organizationId,
          bookingId: booking.id,
          bookingUpdatedAt: booking.updatedAt,
          sourceUnitId: booking.allocation.unitId,
          targetUnitId: targetUnit.id,
          unitTypeId: booking.unitTypeId,
          locationId: booking.locationId,
          startsOn: effectiveStartsOn,
          endsOn: effectiveEndsOn,
          currency: booking.currency,
          totalMinor: booking.totalMinor,
          pricingFingerprint: effectivePricingFingerprint,
        })
      : null;

    return Object.freeze({
      ready: blocker === null,
      blocker,
      checkedAt: databaseClock.now,
      authorityFingerprint,
      booking: Object.freeze({
        id: booking.id,
        startsOn: effectiveStartsOn,
        endsOn: effectiveEndsOn,
        currency: booking.currency,
        totalMinor: booking.totalMinor,
        pricingFingerprint: effectivePricingFingerprint,
        updatedAt: booking.updatedAt,
      }),
      sourceUnit: Object.freeze({
        id: booking.allocation.unit.id,
        code: booking.allocation.unit.code,
        name: booking.allocation.unit.name,
      }),
      targetUnit: targetUnit
        ? Object.freeze({ id: targetUnit.id, code: targetUnit.code, name: targetUnit.name })
        : null,
    });
  }, { isolationLevel: 'Serializable' });
}
