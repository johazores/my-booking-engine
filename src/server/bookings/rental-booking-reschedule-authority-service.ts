import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import {
  buildRentalPricingEvidence,
  RentalAvailabilityIntegrityError,
} from '../inventory/rental-availability-domain.ts';
import { findOverdueRentalCustodyUnitIds } from '../inventory/rental-custody-availability.ts';
import { findRentalUnitOperationalReadinessBlocker } from '../inventory/rental-unit-operational-readiness.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { buildRentalBookingCommercialAmendmentReviewFingerprint } from './rental-booking-commercial-amendment-domain.ts';
import {
  buildRentalBookingRescheduleAuthorityFingerprint,
  buildRentalBookingRescheduleCommercialImpact,
  isRentalBookingCustodyExtensionTarget,
  normalizeRentalBookingRescheduleReviewInput,
  type RentalBookingRescheduleMode,
  type RentalBookingRescheduleReviewInput,
} from './rental-booking-reschedule-domain.ts';

export type RentalBookingRescheduleBlocker =
  | 'NO_CHANGE'
  | 'CUSTODY_EXTENSION_REQUIRED'
  | 'INVENTORY_CONFLICT'
  | 'CURRENCY_CHANGED'
  | 'PRICE_CHANGED'
  | 'COMMERCIAL_AMENDMENT_ACTIVE'
  | 'COMMERCIAL_AMENDMENT_APPLIED';

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
                location: { select: { id: true, code: true, name: true, status: true } },
              },
            },
          },
        },
        fulfillmentEvents: {
          where: { organizationId: input.organizationId },
          orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, kind: true, occurredAt: true },
        },
      },
    });
    if (!booking) throw new RentalBookingRescheduleUnavailableError();

    const pickupEvent = booking.fulfillmentEvents.find((event) => event.kind === 'PICKED_UP') ?? null;
    const returnEvent = booking.fulfillmentEvents.find((event) => event.kind === 'RETURNED') ?? null;
    if (returnEvent) {
      throw new RentalBookingRescheduleUnavailableError(
        'Returned rentals cannot be rescheduled or extended.',
      );
    }
    const mode: RentalBookingRescheduleMode = pickupEvent
      ? 'CUSTODY_EXTENSION'
      : 'PRE_PICKUP_RESCHEDULE';

    const [latestReschedule, latestSubstitution, commercialAmendments] = await Promise.all([
      transaction.rentalBookingReschedule.findFirst({
        where: { organizationId: input.organizationId, bookingId: booking.id },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.rentalBookingUnitSubstitution.findFirst({
        where: { organizationId: input.organizationId, bookingId: booking.id },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.rentalBookingCommercialAmendment.findMany({
        where: {
          organizationId: input.organizationId,
          bookingId: booking.id,
          status: { in: ['PREPARED', 'APPLIED'] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 2,
        select: {
          id: true,
          status: true,
          currency: true,
          beforeTotalMinor: true,
          afterTotalMinor: true,
          expiresAt: true,
          appliedRescheduleId: true,
          appliedAt: true,
        },
      }),
    ]);
    if (commercialAmendments.length > 1) {
      throw new RentalAvailabilityIntegrityError(
        'Rental booking retains conflicting active commercial amendment authority.',
      );
    }
    const existingCommercialAmendment = commercialAmendments[0] ?? null;
    const sourceStartsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
    const sourceEndsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
    const sourcePricingFingerprint = latestReschedule?.targetPricingFingerprint ?? booking.pricingFingerprint;
    const effectiveUnitId = latestSubstitution?.targetUnitId ?? booking.unitId;
    let effectiveAcceptedTotalMinor = booking.totalMinor;
    if (existingCommercialAmendment?.status === 'APPLIED') {
      if (
        existingCommercialAmendment.currency !== booking.currency
        || existingCommercialAmendment.beforeTotalMinor !== booking.totalMinor
        || existingCommercialAmendment.afterTotalMinor <= 0n
        || !existingCommercialAmendment.appliedRescheduleId
        || !existingCommercialAmendment.appliedAt
        || !latestReschedule
        || latestReschedule.currency !== existingCommercialAmendment.currency
        || latestReschedule.totalMinor !== existingCommercialAmendment.afterTotalMinor
        || latestReschedule.appliedAt.getTime() < existingCommercialAmendment.appliedAt.getTime()
      ) {
        throw new RentalAvailabilityIntegrityError(
          'Applied rental commercial amendment does not reconcile to the effective reschedule commercial baseline.',
        );
      }
      effectiveAcceptedTotalMinor = existingCommercialAmendment.afterTotalMinor;
    } else if (
      !existingCommercialAmendment
      && latestReschedule
      && (latestReschedule.currency !== booking.currency || latestReschedule.totalMinor !== booking.totalMinor)
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Rental reschedule history does not reconcile to the immutable booking commercial baseline.',
      );
    }
    const allocation = booking.allocation;

    if (
      !allocation
      || allocation.organizationId !== input.organizationId
      || allocation.bookingId !== booking.id
      || allocation.unitId !== effectiveUnitId
      || allocation.unit.id !== effectiveUnitId
      || allocation.startsOn.getTime() !== sourceStartsOn.getTime()
      || allocation.endsOn.getTime() !== sourceEndsOn.getTime()
    ) {
      throw new RentalAvailabilityIntegrityError('Rental reschedule review requires the exact effective physical-unit allocation.');
    }
    const unit = allocation.unit;
    if (
      unit.status !== 'ACTIVE'
      || unit.unitType.status !== 'ACTIVE'
      || !unit.location
      || unit.location.status !== 'ACTIVE'
      || unit.unitTypeId !== booking.unitTypeId
      || unit.unitType.id !== booking.unitTypeId
      || unit.locationId !== booking.locationId
      || unit.location.id !== booking.locationId
    ) {
      throw new RentalBookingRescheduleUnavailableError('The effective physical unit is no longer active at its retained operating assignment.');
    }

    const [
      blockOverlap,
      competingHold,
      bookingOverlap,
      overdueCustodyUnitIds,
      operationalReadinessBlocker,
      ratePeriods,
    ] = await Promise.all([
      transaction.rentalAvailabilityBlock.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: effectiveUnitId,
          startsOn: { lt: target.endsOn },
          endsOn: { gt: target.startsOn },
        },
        select: { id: true },
      }),
      transaction.rentalAvailabilityHold.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: effectiveUnitId,
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
          unitId: effectiveUnitId,
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
      findOverdueRentalCustodyUnitIds(transaction, {
        organizationId: input.organizationId,
        observedAt: databaseClock.now,
        unitId: effectiveUnitId,
        excludeBookingId: booking.id,
      }),
      findRentalUnitOperationalReadinessBlocker(transaction, {
        organizationId: input.organizationId,
        unitId: effectiveUnitId,
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
      currency: unit.unitType.currency,
      startsOn: target.startsOn,
      endsOn: target.endsOn,
      defaultDailyRateMinor: unit.unitType.defaultDailyRateMinor,
      ratePeriods,
    });
    const commercialImpact = buildRentalBookingRescheduleCommercialImpact({
      acceptedCurrency: booking.currency,
      acceptedTotalMinor: effectiveAcceptedTotalMinor,
      targetCurrency: targetPricing.currency,
      targetTotalMinor: BigInt(targetPricing.totalMinor),
    });

    let blocker: RentalBookingRescheduleBlocker | null = null;
    if (
      target.startsOn.getTime() === sourceStartsOn.getTime()
      && target.endsOn.getTime() === sourceEndsOn.getTime()
    ) blocker = 'NO_CHANGE';
    else if (existingCommercialAmendment?.status === 'PREPARED') blocker = 'COMMERCIAL_AMENDMENT_ACTIVE';
    else if (
      mode === 'CUSTODY_EXTENSION'
      && !isRentalBookingCustodyExtensionTarget({
        sourceStartsOn,
        sourceEndsOn,
        targetStartsOn: target.startsOn,
        targetEndsOn: target.endsOn,
      })
    ) blocker = 'CUSTODY_EXTENSION_REQUIRED';
    else if (
      blockOverlap
      || competingHold
      || bookingOverlap
      || overdueCustodyUnitIds.length > 0
      || operationalReadinessBlocker
    ) blocker = 'INVENTORY_CONFLICT';
    else if (commercialImpact.kind === 'CURRENCY_CHANGED') blocker = 'CURRENCY_CHANGED';
    else if (commercialImpact.kind !== 'UNCHANGED') {
      blocker = existingCommercialAmendment?.status === 'APPLIED'
        ? 'COMMERCIAL_AMENDMENT_APPLIED'
        : 'PRICE_CHANGED';
    }

    const authorityFingerprint = blocker === null
      ? buildRentalBookingRescheduleAuthorityFingerprint({
          organizationId: input.organizationId,
          bookingId: booking.id,
          bookingUpdatedAt: booking.updatedAt,
          unitId: effectiveUnitId,
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
          mode,
          pickupEventId: pickupEvent?.id ?? null,
        })
      : null;
    const commercialAmendmentFingerprint = blocker === 'PRICE_CHANGED'
      && (commercialImpact.kind === 'INCREASE' || commercialImpact.kind === 'DECREASE')
      ? buildRentalBookingCommercialAmendmentReviewFingerprint({
          organizationId: input.organizationId,
          bookingId: booking.id,
          bookingUpdatedAt: booking.updatedAt,
          unitId: effectiveUnitId,
          unitTypeId: booking.unitTypeId,
          locationId: booking.locationId,
          sourceStartsOn,
          sourceEndsOn,
          targetStartsOn: target.startsOn,
          targetEndsOn: target.endsOn,
          currency: targetPricing.currency,
          beforeTotalMinor: effectiveAcceptedTotalMinor,
          afterTotalMinor: BigInt(targetPricing.totalMinor),
          sourcePricingFingerprint,
          targetPricingFingerprint: targetPricing.fingerprint,
          mode,
          pickupEventId: pickupEvent?.id ?? null,
        })
      : null;

    return Object.freeze({
      ready: blocker === null,
      blocker,
      mode,
      checkedAt: databaseClock.now,
      authorityFingerprint,
      commercialAmendmentFingerprint,
      existingCommercialAmendment: existingCommercialAmendment
        ? Object.freeze({
            id: existingCommercialAmendment.id,
            status: existingCommercialAmendment.status,
            expiresAt: existingCommercialAmendment.expiresAt,
            appliedAt: existingCommercialAmendment.appliedAt,
          })
        : null,
      booking: Object.freeze({
        id: booking.id,
        unitId: effectiveUnitId,
        originalUnitId: booking.unitId,
        startsOn: sourceStartsOn,
        endsOn: sourceEndsOn,
        originalStartsOn: booking.startsOn,
        originalEndsOn: booking.endsOn,
        currency: booking.currency,
        totalMinor: effectiveAcceptedTotalMinor,
        originalTotalMinor: booking.totalMinor,
        pricingFingerprint: sourcePricingFingerprint,
        originalPricingFingerprint: booking.pricingFingerprint,
        updatedAt: booking.updatedAt,
        pickupEventId: pickupEvent?.id ?? null,
      }),
      target: Object.freeze({ startsOn: target.startsOn, endsOn: target.endsOn, days: target.days }),
      unit: Object.freeze({
        id: unit.id,
        code: unit.code,
        name: unit.name,
        unitType: Object.freeze({ id: unit.unitType.id, code: unit.unitType.code, name: unit.unitType.name }),
        location: Object.freeze({ id: unit.location.id, code: unit.location.code, name: unit.location.name }),
      }),
      targetPricing: Object.freeze({
        currency: targetPricing.currency,
        totalMinor: BigInt(targetPricing.totalMinor),
        fingerprint: targetPricing.fingerprint,
        quote: targetPricing.quote,
      }),
      commercialImpact,
    });
  }, { isolationLevel: 'Serializable' });
}
