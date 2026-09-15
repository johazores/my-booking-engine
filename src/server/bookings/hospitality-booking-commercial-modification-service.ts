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

    const allocation = booking.allocation;
    if (
      allocation.organizationId !== input.organizationId
      || allocation.bookingId !== booking.id
      || allocation.propertyId !== booking.propertyId
      || allocation.roomTypeId !== booking.roomTypeId
      || allocation.quantity !== booking.quantity
      || allocation.arrivalDate.getTime() !== booking.arrivalDate.getTime()
      || allocation.departureDate.getTime() !== booking.departureDate.getTime()
    ) {
      throw new HospitalityBookingConflictError(
        'Booking allocation no longer matches the confirmed booking snapshot. Refresh before changing commercial terms.',
      );
    }

    const priorAttempt = await transaaction