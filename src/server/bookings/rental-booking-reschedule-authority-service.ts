import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import {
  buildRentalPricingEvidence,
  RentalAvailabilityIntegrityError,
} from '../inventory/rental-availability-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  buildRentalBookingRescheduleAuthorityFingerprint,
  normalizeRentalBookingRescheduleReviewInput,
  type RentalBookingRescheduleReviewInput,
} from './rental-booking-reschedule-domain.ts';

export type RentalBookingRescheduleBlocker =
  | 'NO_CHANGE'
  | 'INVENTORY_CONFLICT'
  | 'PRICE_CHANGED';

export class RentalBookingRescheduleUnavailableError extends Error {
  constructor(message = 'Rental booking is not available for reschedule review in this organization.') {
    super(message);
    this.name = 'RentalBookingRescheduleUnavailableError';
  }
}

export async function reviewRentalBookingRescheduleAuthority(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  target: RentalBookingRescheduleReviewInput;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const target = normalizeRentalBookingRescheduleReviewInput(input.target);

  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' }),
  ]);

  return db.$transaction(async (transaction) => {
    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError('Database time authority is unavailable for rental reschedule review.');
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
            unitType: {
              select: {
                id: true,
                code: true,
                name: true,
                status: true,
                currency: true,
                defaultDailyRateMinor: true,
              },
            },
            location: {
              select: { id: true, code: true, name: true, status: true },
            },
          },
        },
      },
    });
    if (!booking) throw new RentalBookingRescheduleUnavailableError();

    const latestReschedule = await transaction.rentalBookingReschedule.findFirst({
      where: { organizationId: input.organizationId, bookingId: booking.id },
      orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    const sourceStartsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
    const sourceEndsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
    const sourcePricingFingerprint =
      latestReschedule?.targetPricingFingerprint ?? booking.pricingFingerprint;

    if (
      !booking.allocation
      || booking.allocation.organizationId !== input.organizationId
      || booking.allocation.bookingId !== booking.id
      || booking.allocation.unitId !== booking.unitId
      || booking.allocation.startsOn.getTime() !== sourceStartsOn.getTime()
      || booking.allocation.endsOn.getTime() !== sourceEndsOn.getTime()
    ) {
      throw new RentalAvailabilityIntegrityError('Rental reschedule review requires the exact effective physical-unit allocation.');
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
      throw new RentalBookingRescheduleUnavailableError('The booked physical unit is no longer active at its retained operating assignment.');
    }

    const [blockOverlap, competingHold, bookingOverlap, ratePeriods] = await Promise.all([
      transaction.rentalAvailabilityBlock.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: booking.unitId,
          startsOn: { lt: target.endsOn },
          endsOn: { gt: target.startsOn },
        },
        select: { id: true },
      }),
      transaction.rentalAvailabilityHold.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: booking.unitId,
          status: 'ACTIVE',
          expiresAt: { gt: databaseClock.now },
          startsOn: { lt: target.endsOn },
          endsOn: { gt: target.startsOn },
        },
        select: { id: true },
      }),
      transaction.rentalBookingAllocation.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: booking.unitId,
          bookingId: { not: booking.id },
          startsOn: { lt: target.endsOn },
          endsOn: { gt: target.startsOn },
          booking: {
            is: {
              organizationId: input.organizationId,
              status: { not: 'CANCELLED' },
            },
          },
        },
        select: { id: true },
      }),
      transaction.rentalRatePeriod.findMany({
        where: {
          organizationId: input.organizationId,
          unitTypeId: booking.unitTypeId,
          startsOn: { lt: target.endsOn },
          endsOn: { gt: target.startsOn },
        },
        orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
        select: { startsOn: true, endsOn: true, dailyRateMinor: true },
      }),
    ]);

    const targetPricing = buildRentalPricingEvidence({
      unitTypeId: booking.unitTypeId,
      currency: booking.unit.unitType.currency,
      startsOn: target.startsOn,
      endsOn: target.endsOn,
      defaultDailyRateMinor: booking.unit.unitType.defaultDailyRateMinor,
      ratePeriods,
    });

    let blocker: RentalBookingRescheduleBlocker | null = null;
    if (
      target.startsOn.getTime() === sourceStartsOn.getTime()
      && target.endsOn.getTime() === sourceEndsOn.getTime()
    ) {
      blocker = 'NO_CHANGE';
    } else if (blockOverlap || competingHold || bookingOverlap) {
      blocker = 'INVENTORY_CONFLICT';
    } else if (
      targetPricing.currency !== booking.currency
      || BigInt(targetPricing.totalMinor) !== booking.totalMinor
    ) {
      blocker = 'PRICE_CHANGED';
    }

    const authorityFingerprint = blocker === null
      ? buildRentalBookingRescheduleAuthorityFingerprint({
          organizationId: input.organizationId,
          bookingId: booking.id,
          bookingUpdatedAt: booking.updatedAt,
          unitId: booking.unitId,
          unitTypeId: booking.unitTypeId,
          locationId: booking.locationId,
          sourceStartsOn,
          sourceEndsOn,
          targetStartsOn: target.startsOn,
          targetEndsOn: target.endsOn,
          currency: targetPricing.currency,
          totalMinor: BigInt(targetPricing.totalMinor),
          sourcePricingFingerprint,
          targetPricingFingerprint: targetPricing.fingerprint,
        })
      : null;

    return Object.freeze({
      ready: blocker === null,
      blocker,
      checkedAt: databaseClock.now,
      authorityFingerprint,
      booking: Object.freeze({
        id: booking.id,
        unitId: booking.unitId,
        startsOn: sourceStartsOn,
        endsOn: sourceEndsOn,
        originalStartsOn: booking.startsOn,
        originalEndsOn: booking.endsOn,
        currency: booking.currency,
        totalMinor: booking.totalMinor,
        pricingFingerprint: sourcePricingFingerprint,
        originalPricingFingerprint: booking.pricingFingerprint,
        updatedAt: booking.updatedAt,
      }),
      target: Object.freeze({ startsOn: target.startsOn, endsOn: target.endsOn, days: target.days }),
      unit: Object.freeze({
        id: booking.unit.id,
        code: booking.unit.code,
        name: booking.unit.name,
        unitType: Object.freeze({ id: booking.unit.unitType.id, code: booking.unit.unitType.code, name: booking.unit.unitType.name }),
        location: Object.freeze({ id: booking.unit.location.id, code: booking.unit.location.code, name: booking.unit.location.name }),
      }),
      targetPricing: Object.freeze({
        currency: targetPricing.currency,
        totalMinor: BigInt(targetPricing.totalMinor),
        fingerprint: targetPricing.fingerprint,
        quote: targetPricing.quote,
      }),
    });
  }, { isolationLevel: 'Serializable' });
}
