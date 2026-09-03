import { calculateAvailabilityHoldCapacity } from '../availability/availability-hold-domain.ts';
import {
  evaluateAvailabilityRestrictions,
  formatAvailabilityDate,
  normalizeAvailabilityRequest,
} from '../availability/availability-domain.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { quoteHospitalityPriceFromReader } from '../pricing/hospitality-transactional-pricing.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  hospitalityBookingCommercialAllocationLockKeys,
  hospitalityBookingCommercialModificationFingerprint,
  hospitalityBookingCommercialSelectionMatches,
  normalizeHospitalityBookingCommercialModificationInput,
  type HospitalityBookingCommercialModificationInput,
} from './booking-commercial-modification-domain.ts';
import { hospitalityBookingPriceSnapshotMatches } from './booking-reschedule-domain.ts';
import {
  ACTIVE_COMMERCIAL_AMENDMENT_CONFLICT_MESSAGE,
  findActiveHospitalityBookingCommercialAmendment,
} from './hospitality-booking-commercial-amendment-guard.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import { persistHospitalityBookingPricingEvidence } from './hospitality-booking-pricing-evidence-service.ts';
import {
  HospitalityBookingConflictError,
  HospitalityBookingPriceChangedError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-service.ts';

function readAuditModificationPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  return {
    idempotencyKey: typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : null,
    modificationFingerprint: typeof payload.modificationFingerprint === 'string' ? payload.modificationFingerprint : null,
  };
}

function lastOccupiedDate(departureDate: Date) {
  return new Date(departureDate.getTime() - 86_400_000);
}

export async function getHospitalityBookingCommercialModificationOptions(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'booking:manage',
  });

  const booking = await db.hospitalityBooking.findFirst({
    where: { id: input.bookingId, organizationId: input.organizationId },
    select: {
      id: true,
      propertyId: true,
      arrivalDate: true,
      departureDate: true,
      status: true,
      currency: true,
    },
  });
  if (!booking) throw new HospitalityBookingUnavailableError();

  const [assignments, addons] = await Promise.all([
    db.hospitalityRoomTypeRatePlan.findMany({
      where: {
        organizationId: input.organizationId,
        propertyId: booking.propertyId,
        roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
        ratePlan: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
      },
      select: {
        roomTypeId: true,
        ratePlanId: true,
        roomType: { select: { name: true, maxOccupancy: true } },
        ratePlan: { select: { name: true } },
      },
      orderBy: [{ roomTypeId: 'asc' }, { ratePlanId: 'asc' }],
    }),
    db.hospitalityAddon.findMany({
      where: {
        organizationId: input.organizationId,
        propertyId: booking.propertyId,
        status: 'ACTIVE',
        startDate: { lte: booking.arrivalDate },
        endDate: { gte: lastOccupiedDate(booking.departureDate) },
      },
      select: {
        id: true,
        code: true,
        name: true,
        pricingModel: true,
        maxQuantity: true,
        roomTypeId: true,
        ratePlanId: true,
      },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
    }),
  ]);

  return {
    bookingId: booking.id,
    status: booking.status,
    currency: booking.currency,
    assignments,
    addons,
  };
}

export async function modifyHospitalityBookingCommercialTerms(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  change: HospitalityBookingCommercialModificationInput;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'booking:manage',
  });

  const change = normalizeHospitalityBookingCommercialModificationInput(input.change);
  const modificationFingerprint = hospitalityBookingCommercialModificationFingerprint(change);
  const now = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;

    const initial = await transaction.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { id: true, propertyId: true, roomTypeId: true },
    });
    if (!initial) throw new HospitalityBookingUnavailableError();

    for (const lockKey of hospitalityBookingCommercialAllocationLockKeys({
      organizationId: input.organizationId,
      propertyId: initial.propertyId,
      currentRoomTypeId: initial.roomTypeId,
      targetRoomTypeId: change.roomTypeId,
    })) {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    }

    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      include: { allocation: true, _count: { select: { guests: true } } },
    });
    if (!booking) throw new HospitalityBookingUnavailableError();
    if (booking.status !== 'CONFIRMED' || !booking.allocation) {
      throw new HospitalityBookingConflictError('Only confirmed bookings with an active allocation can be commercially modified.');
    }

    const priorAttempt = await transaction.auditEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        resourceType: 'hospitality-booking',
        resourceId: booking.id,
        action: 'booking.commercial-modified',
        afterData: { path: ['idempotencyKey'], equals: change.idempotencyKey },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { afterData: true },
    });
    if (priorAttempt) {
      const prior = readAuditModificationPayload(priorAttempt.afterData);
      if (!prior || prior.modificationFingerprint !== modificationFingerprint) {
        throw new HospitalityBookingConflictError('Idempotency key was already used for a different commercial booking modification.');
      }
      if (!hospitalityBookingCommercialSelectionMatches(booking, change)) {
        throw new HospitalityBookingConflictError('This modification already completed, but the booking was changed again afterward. Refresh before retrying.');
      }
      return booking;
    }

    if (hospitalityBookingCommercialSelectionMatches(booking, change)) return booking;

    const activeAmendment = await findActiveHospitalityBookingCommercialAmendment({
      reader: transaction,
      organizationId: input.organizationId,
      bookingId: booking.id,
      now,
    });
    if (activeAmendment) {
      throw new HospitalityBookingConflictError(ACTIVE_COMMERCIAL_AMENDMENT_CONFLICT_MESSAGE);
    }

    const activePayment = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        status: { in: ['PENDING', 'AMBIGUOUS'] },
      },
      select: { id: true },
    });
    if (activePayment) {
      throw new HospitalityBookingConflictError(
        'Booking has an unresolved payment operation. Resolve the payment attempt before changing commercial terms.',
      );
    }

    const assignment = await transaction.hospitalityRoomTypeRatePlan.findFirst({
      where: {
        organizationId: input.organizationId,
        propertyId: booking.propertyId,
        roomTypeId: change.roomTypeId,
        ratePlanId: change.ratePlanId,
        roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
        ratePlan: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
      },
      select: { roomType: { select: { maxOccupancy: true } } },
    });
    if (!assignment) {
      throw new HospitalityBookingUnavailableError('The requested room type and rate plan are no longer active and assigned.');
    }
    if (booking._count.guests > change.quantity * assignment.roomType.maxOccupancy) {
      throw new HospitalityBookingConflictError('The current traveler count exceeds the requested room quantity and room-type occupancy.');
    }

    const availabilityRequest = normalizeAvailabilityRequest({
      propertyId: booking.propertyId,
      roomTypeId: change.roomTypeId,
      arrivalDate: formatAvailabilityDate(booking.arrivalDate),
      departureDate: formatAvailabilityDate(booking.departureDate),
      quantity: change.quantity,
    });

    const [physicalCapacity, restrictions, windows, activeHolds, otherAllocations] = await Promise.all([
      transaction.hospitalityRoom.count({
        where: {
          organizationId: input.organizationId,
          propertyId: booking.propertyId,
          roomTypeId: change.roomTypeId,
          status: 'ACTIVE',
        },
      }),
      transaction.hospitalityRestriction.findMany({
        where: {
          organizationId: input.organizationId,
          propertyId: booking.propertyId,
          ratePlanId: change.ratePlanId,
          status: 'ACTIVE',
          startDate: { lte: booking.departureDate },
          endDate: { gte: booking.arrivalDate },
          OR: [{ roomTypeId: null }, { roomTypeId: change.roomTypeId }],
        },
        select: {
          startDate: true,
          endDate: true,
          minStayNights: true,
          maxStayNights: true,
          closedToArrival: true,
          closedToDeparture: true,
        },
      }),
      transaction.hospitalityAvailabilityWindow.findMany({
        where: {
          organizationId: input.organizationId,
          propertyId: booking.propertyId,
          roomTypeId: change.roomTypeId,
          status: 'ACTIVE',
          startDate: { lt: booking.departureDate },
          endDate: { gte: booking.arrivalDate },
        },
        select: { startDate: true, endDate: true, capacityLimit: true },
      }),
      transaction.hospitalityAvailabilityHold.findMany({
        where: {
          organizationId: input.organizationId,
          propertyId: booking.propertyId,
          roomTypeId: change.roomTypeId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
          arrivalDate: { lt: booking.departureDate },
          departureDate: { gt: booking.arrivalDate },
        },
        select: { arrivalDate: true, departureDate: true, quantity: true },
      }),
      transaction.hospitalityBookingAllocation.findMany({
        where: {
          organizationId: input.organizationId,
          propertyId: booking.propertyId,
          roomTypeId: change.roomTypeId,
          bookingId: { not: booking.id },
          arrivalDate: { lt: booking.departureDate },
          departureDate: { gt: booking.arrivalDate },
          booking: { is: { status: { not: 'CANCELLED' } } },
        },
        select: { arrivalDate: true, departureDate: true, quantity: true },
      }),
    ]);

    const restrictionResult = evaluateAvailabilityRestrictions({
      arrivalDate: availabilityRequest.arrivalDate,
      departureDate: availabilityRequest.departureDate,
      stayNights: availabilityRequest.stayNights,
      restrictions,
    });
    const capacity = calculateAvailabilityHoldCapacity({
      physicalCapacity,
      arrivalDate: availabilityRequest.arrivalDate,
      departureDate: availabilityRequest.departureDate,
      windows,
      holds: activeHolds,
      allocations: otherAllocations,
    });
    if (!restrictionResult.allowed) {
      throw new HospitalityBookingUnavailableError(
        `Requested commercial terms violate booking restrictions: ${restrictionResult.reasons.join(', ')}.`,
      );
    }
    if (capacity.sellableUnits < change.quantity) {
      throw new HospitalityBookingUnavailableError('Requested room type no longer has enough sellable inventory for this booking.');
    }

    const latestPrice = await quoteHospitalityPriceFromReader({
      reader: transaction,
      organizationId: input.organizationId,
      request: {
        propertyId: booking.propertyId,
        roomTypeId: change.roomTypeId,
        ratePlanId: change.ratePlanId,
        arrivalDate: formatAvailabilityDate(booking.arrivalDate),
        departureDate: formatAvailabilityDate(booking.departureDate),
        quantity: change.quantity,
      },
      addonSelections: change.addonSelections,
    });
    if (!hospitalityBookingPriceSnapshotMatches(booking, latestPrice)) {
      throw new HospitalityBookingPriceChangedError(
        'Commercial modification changes the persisted booking price. Complete a payment-adjustment workflow before applying this change.',
      );
    }

    const beforeData = {
      roomTypeId: booking.roomTypeId,
      ratePlanId: booking.ratePlanId,
      quantity: booking.quantity,
      addonSelections: booking.addonSelections,
      currency: booking.currency,
      totalMinor: booking.totalMinor.toString(),
      paymentStatus: booking.paymentStatus,
      pricingFingerprint: booking.pricingFingerprint,
    };

    const updated = await transaction.hospitalityBooking.update({
      where: { id: booking.id },
      data: {
        roomTypeId: change.roomTypeId,
        ratePlanId: change.ratePlanId,
        quantity: change.quantity,
        addonSelections: change.addonSelections,
        pricingFingerprint: latestPrice.fingerprint,
      },
    });
    await transaction.hospitalityBookingAllocation.update({
      where: { organizationId_bookingId: { organizationId: input.organizationId, bookingId: booking.id } },
      data: { roomTypeId: change.roomTypeId, quantity: change.quantity },
    });
    await persistHospitalityBookingPricingEvidence({
      transaction,
      organizationId: input.organizationId,
      bookingId: booking.id,
      evidenceKey: `commercial-modification:${booking.id}:${change.idempotencyKey}`,
      source: 'BOOKING_COMMERCIAL_MODIFICATION',
      bookingVersion: updated.updatedAt,
      state: {
        propertyId: updated.propertyId,
        roomTypeId: updated.roomTypeId,
        ratePlanId: updated.ratePlanId,
        arrivalDate: updated.arrivalDate,
        departureDate: updated.departureDate,
        quantity: updated.quantity,
        addonSelections: change.addonSelections,
      },
      quote: latestPrice,
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.commercial-modified',
        resourceType: 'hospitality-booking',
        resourceId: booking.id,
        beforeData,
        afterData: {
          roomTypeId: updated.roomTypeId,
          ratePlanId: updated.ratePlanId,
          quantity: updated.quantity,
          addonSelections: updated.addonSelections,
          currency: updated.currency,
          totalMinor: updated.totalMinor.toString(),
          paymentStatus: updated.paymentStatus,
          pricingFingerprint: updated.pricingFingerprint,
          idempotencyKey: change.idempotencyKey,
          modificationFingerprint,
        },
      },
    });

    return updated;
  }, { isolationLevel: 'Serializable' });
}
