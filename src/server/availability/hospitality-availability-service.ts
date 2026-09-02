import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { shouldProtectPendingPublicBookingAllocation } from '../bookings/public-booking-payment-window.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { calculateAvailabilityHoldCapacity } from './availability-hold-domain.ts';
import {
  evaluateAvailabilityRestrictions,
  normalizeAvailabilityRequest,
  type AvailabilityRequestInput,
} from './availability-domain.ts';

export class AvailabilityUnavailableError extends Error {
  constructor(message = 'Availability scope is not available in this organization.') {
    super(message);
    this.name = 'AvailabilityUnavailableError';
  }
}

export async function readHospitalityAvailabilityForOrganization(input: {
  organizationId: string;
  request: AvailabilityRequestInput;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const request = normalizeAvailabilityRequest(input.request);
  assertUuidIdentifier(request.propertyId, 'propertyId');
  assertUuidIdentifier(request.roomTypeId, 'roomTypeId');
  assertUuidIdentifier(request.ratePlanId, 'ratePlanId');
  const now = input.now ?? new Date();

  const [organization, assignment] = await Promise.all([
    db.organization.findFirst({
      where: { id: input.organizationId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    }),
    db.hospitalityRoomTypeRatePlan.findFirst({
      where: {
        organizationId: input.organizationId,
        propertyId: request.propertyId,
        roomTypeId: request.roomTypeId,
        ratePlanId: request.ratePlanId,
        roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
        ratePlan: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
      },
      include: {
        roomType: { select: { id: true, name: true, code: true } },
        ratePlan: { select: { id: true, name: true, code: true } },
      },
    }),
  ]);
  if (!organization || !assignment) throw new AvailabilityUnavailableError('Room type and rate plan must be active and assigned within the same active organization.');

  const [physicalCapacity, restrictions, windows, activeHolds, allocations] = await Promise.all([
    db.hospitalityRoom.count({
      where: { organizationId: input.organizationId, propertyId: request.propertyId, roomTypeId: request.roomTypeId, status: 'ACTIVE' },
    }),
    db.hospitalityRestriction.findMany({
      where: {
        organizationId: input.organizationId,
        propertyId: request.propertyId,
        ratePlanId: request.ratePlanId,
        status: 'ACTIVE',
        startDate: { lte: request.departureDate },
        endDate: { gte: request.arrivalDate },
        OR: [{ roomTypeId: null }, { roomTypeId: request.roomTypeId }],
      },
      select: { startDate: true, endDate: true, minStayNights: true, maxStayNights: true, closedToArrival: true, closedToDeparture: true },
    }),
    db.hospitalityAvailabilityWindow.findMany({
      where: {
        organizationId: input.organizationId,
        propertyId: request.propertyId,
        roomTypeId: request.roomTypeId,
        status: 'ACTIVE',
        startDate: { lt: request.departureDate },
        endDate: { gte: request.arrivalDate },
      },
      select: { startDate: true, endDate: true, capacityLimit: true },
    }),
    db.hospitalityAvailabilityHold.findMany({
      where: {
        organizationId: input.organizationId,
        propertyId: request.propertyId,
        roomTypeId: request.roomTypeId,
        status: 'ACTIVE',
        expiresAt: { gt: now },
        arrivalDate: { lt: request.departureDate },
        departureDate: { gt: request.arrivalDate },
      },
      select: { arrivalDate: true, departureDate: true, quantity: true },
    }),
    db.hospitalityBookingAllocation.findMany({
      where: {
        organizationId: input.organizationId,
        propertyId: request.propertyId,
        roomTypeId: request.roomTypeId,
        arrivalDate: { lt: request.departureDate },
        departureDate: { gt: request.arrivalDate },
        booking: { is: { status: { not: 'CANCELLED' } } },
      },
      select: {
        bookingId: true,
        arrivalDate: true,
        departureDate: true,
        quantity: true,
        booking: { select: { status: true } },
      },
    }),
  ]);

  const pendingPublicCandidateIds = [...new Set(
    allocations
      .filter((allocation) => allocation.booking.status === 'PENDING_CONFIRMATION')
      .map((allocation) => allocation.bookingId),
  )];
  let protectedAllocations = allocations;
  if (pendingPublicCandidateIds.length > 0) {
    const [ownerships, checkoutSessions, paymentTransactions] = await Promise.all([
      db.publicBookingBookingOwnership.findMany({
        where: { organizationId: input.organizationId, bookingId: { in: pendingPublicCandidateIds } },
        select: { bookingId: true, createdAt: true },
      }),
      db.paymentCheckoutSession.findMany({
        where: {
          organizationId: input.organizationId,
          bookingId: { in: pendingPublicCandidateIds },
          status: 'OPEN',
          expiresAt: { gt: now },
        },
        select: { bookingId: true, expiresAt: true },
      }),
      db.paymentTransaction.findMany({
        where: {
          organizationId: input.organizationId,
          bookingId: { in: pendingPublicCandidateIds },
          kind: { in: ['AUTHORIZATION', 'CAPTURE'] },
          status: { in: ['PENDING', 'AMBIGUOUS', 'SUCCEEDED'] },
        },
        select: { bookingId: true, status: true, createdAt: true },
      }),
    ]);
    const ownershipByBooking = new Map(ownerships.map((ownership) => [ownership.bookingId, ownership]));
    const checkoutExpiryByBooking = new Map<string, Date>();
    for (const session of checkoutSessions) {
      const current = checkoutExpiryByBooking.get(session.bookingId);
      if (!current || session.expiresAt > current) checkoutExpiryByBooking.set(session.bookingId, session.expiresAt);
    }
    const paymentEvidenceByBooking = new Map<string, { hasSuccessfulPayment: boolean; unresolvedPaymentCreatedAt: Date | null }>();
    for (const payment of paymentTransactions) {
      const evidence = paymentEvidenceByBooking.get(payment.bookingId) ?? { hasSuccessfulPayment: false, unresolvedPaymentCreatedAt: null };
      if (payment.status === 'SUCCEEDED') evidence.hasSuccessfulPayment = true;
      if (payment.status === 'PENDING' || payment.status === 'AMBIGUOUS') {
        if (!evidence.unresolvedPaymentCreatedAt || payment.createdAt > evidence.unresolvedPaymentCreatedAt) {
          evidence.unresolvedPaymentCreatedAt = payment.createdAt;
        }
      }
      paymentEvidenceByBooking.set(payment.bookingId, evidence);
    }

    protectedAllocations = allocations.filter((allocation) => {
      if (allocation.booking.status !== 'PENDING_CONFIRMATION') return true;
      const ownership = ownershipByBooking.get(allocation.bookingId);
      if (!ownership) return true;
      const evidence = paymentEvidenceByBooking.get(allocation.bookingId);
      return shouldProtectPendingPublicBookingAllocation({
        ownershipCreatedAt: ownership.createdAt,
        openCheckoutExpiresAt: checkoutExpiryByBooking.get(allocation.bookingId) ?? null,
        unresolvedPaymentCreatedAt: evidence?.unresolvedPaymentCreatedAt ?? null,
        hasSuccessfulPayment: evidence?.hasSuccessfulPayment ?? false,
        now,
      });
    });
  }

  const restrictionResult = evaluateAvailabilityRestrictions({ arrivalDate: request.arrivalDate, departureDate: request.departureDate, stayNights: request.stayNights, restrictions });
  const capacity = calculateAvailabilityHoldCapacity({
    physicalCapacity,
    arrivalDate: request.arrivalDate,
    departureDate: request.departureDate,
    windows,
    holds: activeHolds,
    allocations: protectedAllocations,
  });
  const capacityAvailable = capacity.sellableUnits >= request.quantity;

  return {
    scope: { propertyId: request.propertyId, roomType: assignment.roomType, ratePlan: assignment.ratePlan },
    stay: { arrivalDate: request.arrivalDate, departureDate: request.departureDate, nights: request.stayNights, quantity: request.quantity },
    capacity: {
      physicalUnits: physicalCapacity,
      sellableUnits: capacity.sellableUnits,
      requestedUnits: request.quantity,
      remainingUnits: Math.max(0, capacity.sellableUnits - request.quantity),
      heldUnits: capacity.peakHeldUnits,
      allocatedUnits: capacity.peakAllocatedUnits,
      protectedUnits: capacity.peakProtectedUnits,
      constrainedNightCount: capacity.constrainedNightCount,
      source: protectedAllocations.length > 0
        ? 'PHYSICAL_ROOMS_WITH_BOOKINGS' as const
        : activeHolds.length > 0
          ? 'PHYSICAL_ROOMS_WITH_WINDOWS_AND_HOLDS' as const
          : windows.length > 0
            ? 'PHYSICAL_ROOMS_WITH_WINDOWS' as const
            : 'ACTIVE_PHYSICAL_ROOMS' as const,
      windowCount: windows.length,
      activeHoldCount: activeHolds.length,
      bookingAllocationCount: protectedAllocations.length,
    },
    restrictions: restrictionResult,
    available: capacityAvailable && restrictionResult.allowed,
    unavailableReasons: [...(capacityAvailable ? [] : ['insufficient-capacity']), ...restrictionResult.reasons],
  };
}

export async function readHospitalityAvailability(input: {
  organizationId: string;
  actorUserId: string;
  request: AvailabilityRequestInput;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'availability:read',
  });

  return readHospitalityAvailabilityForOrganization({
    organizationId: input.organizationId,
    request: input.request,
    now: input.now,
  });
}
