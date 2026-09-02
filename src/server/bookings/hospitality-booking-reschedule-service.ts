import { hospitalityAvailabilityAllocationLockKey } from '../availability/availability-allocation-lock.ts';
import { calculateAvailabilityHoldCapacity } from '../availability/availability-hold-domain.ts';
import { evaluateAvailabilityRestrictions, formatAvailabilityDate } from '../availability/availability-domain.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { quoteHospitalityPriceFromReader } from '../pricing/hospitality-transactional-pricing.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  hospitalityBookingPriceSnapshotMatches,
  normalizeHospitalityBookingRescheduleInput,
  type HospitalityBookingRescheduleInput,
} from './booking-reschedule-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import {
  HospitalityBookingConflictError,
  HospitalityBookingPriceChangedError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-service.ts';

function readAuditReschedulePayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  return {
    idempotencyKey: typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : null,
    arrivalDate: typeof payload.arrivalDate === 'string' ? payload.arrivalDate : null,
    departureDate: typeof payload.departureDate === 'string' ? payload.departureDate : null,
  };
}

export async function rescheduleHospitalityBooking(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  change: HospitalityBookingRescheduleInput;
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

  const change = normalizeHospitalityBookingRescheduleInput(input.change);
  const now = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({ organizationId: input.organizationId, bookingId: input.bookingId })}, 0))`;

    const initial = await transaction.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { id: true, propertyId: true, roomTypeId: true },
    });
    if (!initial) throw new HospitalityBookingUnavailableError();

    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityAvailabilityAllocationLockKey({ organizationId: input.organizationId, propertyId: initial.propertyId, roomTypeId: initial.roomTypeId })}, 0))`;

    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      include: { allocation: true },
    });
    if (!booking) throw new HospitalityBookingUnavailableError();
    if (booking.status !== 'CONFIRMED' || !booking.allocation) {
      throw new HospitalityBookingConflictError('Only confirmed bookings with an active allocation can be rescheduled.');
    }

    const priorAttempt = await transaction.auditEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        resourceType: 'hospitality-booking',
        resourceId: booking.id,
        action: 'booking.rescheduled',
        afterData: { path: ['idempotencyKey'], equals: change.idempotencyKey },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { afterData: true },
    });
    if (priorAttempt) {
      const prior = readAuditReschedulePayload(priorAttempt.afterData);
      const requestedArrival = formatAvailabilityDate(change.arrivalDate);
      const requestedDeparture = formatAvailabilityDate(change.departureDate);
      if (!prior || prior.arrivalDate !== requestedArrival || prior.departureDate !== requestedDeparture) {
        throw new HospitalityBookingConflictError('Idempotency key was already used for a different booking reschedule request.');
      }
      if (formatAvailabilityDate(booking.arrivalDate) !== requestedArrival || formatAvailabilityDate(booking.departureDate) !== requestedDeparture) {
        throw new HospitalityBookingConflictError('This reschedule request already completed, but the booking was changed again afterward. Refresh before retrying.');
      }
      return booking;
    }

    if (booking.arrivalDate.getTime() === change.arrivalDate.getTime() && booking.departureDate.getTime() === change.departureDate.getTime()) {
      return booking;
    }

    const activePayment = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        kind: { in: ['AUTHORIZATION', 'CAPTURE'] },
        status: { in: ['PENDING', 'AMBIGUOUS'] },
      },
      select: { id: true },
    });
    if (activePayment) {
      throw new HospitalityBookingConflictError(
        'Booking has an unresolved payment operation. Resolve the payment attempt before rescheduling the booking.',
      );
    }

    const assignment = await transaction.hospitalityRoomTypeRatePlan.findFirst({
      where: {
        organizationId: input.organizationId,
        propertyId: booking.propertyId,
        roomTypeId: booking.roomTypeId,
        ratePlanId: booking.ratePlanId,
        roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
        ratePlan: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
      },
      select: { id: true },
    });
    if (!assignment) throw new HospitalityBookingUnavailableError('The booked room type and rate plan are no longer active and assigned.');

    const [physicalCapacity, restrictions, windows, activeHolds, otherAllocations] = await Promise.all([
      transaction.hospitalityRoom.count({
        where: { organizationId: input.organizationId, propertyId: booking.propertyId, roomTypeId: booking.roomTypeId, status: 'ACTIVE' },
      }),
      transaction.hospitalityRestriction.findMany({
        where: {
          organizationId: input.organizationId,
          propertyId: booking.propertyId,
          ratePlanId: booking.ratePlanId,
          status: 'ACTIVE',
          startDate: { lte: change.departureDate },
          endDate: { gte: change.arrivalDate },
          OR: [{ roomTypeId: null }, { roomTypeId: booking.roomTypeId }],
        },
        select: { startDate: true, endDate: true, minStayNights: true, maxStayNights: true, closedToArrival: true, closedToDeparture: true },
      }),
      transaction.hospitalityAvailabilityWindow.findMany({
        where: {
          organizationId: input.organizationId,
          propertyId: booking.propertyId,
          roomTypeId: booking.roomTypeId,
          status: 'ACTIVE',
          startDate: { lt: change.departureDate },
          endDate: { gte: change.arrivalDate },
        },
        select: { startDate: true, endDate: true, capacityLimit: true },
      }),
      transaction.hospitalityAvailabilityHold.findMany({
        where: {
          organizationId: input.organizationId,
          propertyId: booking.propertyId,
          roomTypeId: booking.roomTypeId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
          arrivalDate: { lt: change.departureDate },
          departureDate: { gt: change.arrivalDate },
        },
        select: { arrivalDate: true, departureDate: true, quantity: true },
      }),
      transaction.hospitalityBookingAllocation.findMany({
        where: {
          organizationId: input.organizationId,
          propertyId: booking.propertyId,
          roomTypeId: booking.roomTypeId,
          bookingId: { not: booking.id },
          arrivalDate: { lt: change.departureDate },
          departureDate: { gt: change.arrivalDate },
          booking: { is: { status: { not: 'CANCELLED' } } },
        },
        select: { arrivalDate: true, departureDate: true, quantity: true },
      }),
    ]);

    const restrictionResult = evaluateAvailabilityRestrictions({
      arrivalDate: change.arrivalDate,
      departureDate: change.departureDate,
      stayNights: change.stayNights,
      restrictions,
    });
    const capacity = calculateAvailabilityHoldCapacity({
      physicalCapacity,
      arrivalDate: change.arrivalDate,
      departureDate: change.departureDate,
      windows,
      holds: activeHolds,
      allocations: otherAllocations,
    });
    if (!restrictionResult.allowed) {
      throw new HospitalityBookingUnavailableError(`Requested dates violate booking restrictions: ${restrictionResult.reasons.join(', ')}.`);
    }
    if (capacity.sellableUnits < booking.quantity) {
      throw new HospitalityBookingUnavailableError('Requested dates no longer have enough sellable inventory for this booking.');
    }

    if (!Array.isArray(booking.addonSelections)) {
      throw new HospitalityBookingConflictError('Persisted booking add-on selections are invalid.');
    }
    const latestPrice = await quoteHospitalityPriceFromReader({
      reader: transaction,
      organizationId: input.organizationId,
      request: {
        propertyId: booking.propertyId,
        roomTypeId: booking.roomTypeId,
        ratePlanId: booking.ratePlanId,
        arrivalDate: formatAvailabilityDate(change.arrivalDate),
        departureDate: formatAvailabilityDate(change.departureDate),
        quantity: booking.quantity,
      },
      addonSelections: booking.addonSelections as Parameters<typeof quoteHospitalityPriceFromReader>[0]['addonSelections'],
    });
    if (!hospitalityBookingPriceSnapshotMatches(booking, latestPrice)) {
      throw new HospitalityBookingPriceChangedError('Rescheduling changes the persisted booking price. Complete a payment-adjustment workflow before applying this change.');
    }

    const beforeArrivalDate = formatAvailabilityDate(booking.arrivalDate);
    const beforeDepartureDate = formatAvailabilityDate(booking.departureDate);
    const afterArrivalDate = formatAvailabilityDate(change.arrivalDate);
    const afterDepartureDate = formatAvailabilityDate(change.departureDate);

    const updated = await transaction.hospitalityBooking.update({
      where: { id: booking.id },
      data: { arrivalDate: change.arrivalDate, departureDate: change.departureDate },
    });
    await transaction.hospitalityBookingAllocation.update({
      where: { organizationId_bookingId: { organizationId: input.organizationId, bookingId: booking.id } },
      data: { arrivalDate: change.arrivalDate, departureDate: change.departureDate },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rescheduled',
        resourceType: 'hospitality-booking',
        resourceId: booking.id,
        beforeData: {
          arrivalDate: beforeArrivalDate,
          departureDate: beforeDepartureDate,
          quantity: booking.quantity,
          currency: booking.currency,
          totalMinor: booking.totalMinor.toString(),
          paymentStatus: booking.paymentStatus,
        },
        afterData: {
          arrivalDate: afterArrivalDate,
          departureDate: afterDepartureDate,
          quantity: updated.quantity,
          currency: updated.currency,
          totalMinor: updated.totalMinor.toString(),
          paymentStatus: updated.paymentStatus,
          idempotencyKey: change.idempotencyKey,
        },
      },
    });

    return updated;
  }, { isolationLevel: 'Serializable' });
}
