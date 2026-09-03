import type { Prisma } from '../../generated/prisma/client.ts';
import { calculateAvailabilityHoldCapacity } from '../availability/availability-hold-domain.ts';
import {
  evaluateAvailabilityRestrictions,
  formatAvailabilityDate,
  normalizeAvailabilityRequest,
} from '../availability/availability-domain.ts';
import { releaseHospitalityAvailabilityHoldInTransaction } from '../availability/hospitality-availability-hold-core.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import {
  normalizeHospitalityAddonSelections,
  type HospitalityAddonSelectionInput,
} from '../pricing/hospitality-addon-domain.ts';
import {
  HospitalityTransactionalPricingUnavailableError,
  quoteHospitalityPriceFromReader,
} from '../pricing/hospitality-transactional-pricing.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HospitalityCommercialAmendmentApplyConsistencyError,
  assertHospitalityCommercialAmendmentApplyConsistency,
} from './booking-commercial-amendment-apply-domain.ts';
import {
  hospitalityCommercialAmendmentHoldIdempotencyKey,
  hospitalityCommercialAmendmentProtectionQuantity,
} from './booking-commercial-amendment-domain.ts';
import { deriveHospitalityCommercialAmendmentSettlementState } from './booking-commercial-amendment-settlement-domain.ts';
import {
  hospitalityBookingCommercialAllocationLockKeys,
  hospitalityBookingCommercialModificationFingerprint,
} from './booking-commercial-modification-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import {
  HospitalityBookingConflictError,
  HospitalityBookingPriceChangedError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-service.ts';

function priceSnapshot(input: {
  currency: string;
  accommodationSubtotalMinor: bigint;
  taxTotalMinor: bigint;
  feeTotalMinor: bigint;
  addonTotalMinor: bigint;
  totalMinor: bigint;
  pricingFingerprint: string;
}) {
  return {
    currency: input.currency,
    accommodationSubtotalMinor: input.accommodationSubtotalMinor.toString(),
    taxTotalMinor: input.taxTotalMinor.toString(),
    feeTotalMinor: input.feeTotalMinor.toString(),
    addonTotalMinor: input.addonTotalMinor.toString(),
    totalMinor: input.totalMinor.toString(),
    pricingFingerprint: input.pricingFingerprint,
  };
}

function amendmentBeforePrice(amendment: {
  currency: string;
  beforeAccommodationSubtotalMinor: bigint;
  beforeTaxTotalMinor: bigint;
  beforeFeeTotalMinor: bigint;
  beforeAddonTotalMinor: bigint;
  beforeTotalMinor: bigint;
  beforePricingFingerprint: string;
}) {
  return priceSnapshot({
    currency: amendment.currency,
    accommodationSubtotalMinor: amendment.beforeAccommodationSubtotalMinor,
    taxTotalMinor: amendment.beforeTaxTotalMinor,
    feeTotalMinor: amendment.beforeFeeTotalMinor,
    addonTotalMinor: amendment.beforeAddonTotalMinor,
    totalMinor: amendment.beforeTotalMinor,
    pricingFingerprint: amendment.beforePricingFingerprint,
  });
}

function amendmentAfterPrice(amendment: {
  currency: string;
  afterAccommodationSubtotalMinor: bigint;
  afterTaxTotalMinor: bigint;
  afterFeeTotalMinor: bigint;
  afterAddonTotalMinor: bigint;
  afterTotalMinor: bigint;
  afterPricingFingerprint: string;
}) {
  return priceSnapshot({
    currency: amendment.currency,
    accommodationSubtotalMinor: amendment.afterAccommodationSubtotalMinor,
    taxTotalMinor: amendment.afterTaxTotalMinor,
    feeTotalMinor: amendment.afterFeeTotalMinor,
    addonTotalMinor: amendment.afterAddonTotalMinor,
    totalMinor: amendment.afterTotalMinor,
    pricingFingerprint: amendment.afterPricingFingerprint,
  });
}

function quotePriceSnapshot(quote: Awaited<ReturnType<typeof quoteHospitalityPriceFromReader>>) {
  return {
    currency: quote.currency,
    accommodationSubtotalMinor: quote.accommodationSubtotalMinor,
    taxTotalMinor: quote.taxTotalMinor,
    feeTotalMinor: quote.feeTotalMinor,
    addonTotalMinor: quote.addonTotalMinor,
    totalMinor: quote.totalMinor,
    pricingFingerprint: quote.fingerprint,
  };
}

function parsePersistedAddonSelections(value: Prisma.JsonValue, label: string) {
  if (!Array.isArray(value)) {
    throw new HospitalityBookingConflictError(`${label} add-on selections are invalid.`);
  }
  try {
    return normalizeHospitalityAddonSelections(value as HospitalityAddonSelectionInput[]);
  } catch {
    throw new HospitalityBookingConflictError(`${label} add-on selections are invalid.`);
  }
}

function assertSameDate(left: Date, right: Date) {
  return left.getTime() === right.getTime();
}

function mapApplyConsistencyError(error: unknown): never {
  if (!(error instanceof HospitalityCommercialAmendmentApplyConsistencyError)) throw error;
  if (error.reason === 'TARGET_PRICE_CHANGED' || error.reason === 'ADJUSTMENT_IDENTITY_CHANGED') {
    throw new HospitalityBookingPriceChangedError(error.message);
  }
  throw new HospitalityBookingConflictError(error.message);
}

function settlementConflictMessage(
  settlement: ReturnType<typeof deriveHospitalityCommercialAmendmentSettlementState>,
) {
  if ('reason' in settlement) return settlement.reason;
  if (settlement.state === 'REQUIRES_EXECUTION') {
    return `Commercial amendment still requires ${settlement.remainingAdjustmentMinor.toString()} minor units of settlement.`;
  }
  return 'Commercial amendment payment settlement is not ready to apply.';
}

export async function applyHospitalityBookingCommercialAmendment(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');
  await Promise.all([
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'booking:manage',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'payment:manage',
    }),
  ]);
  const now = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;

    const amendment = await transaction.hospitalityBookingCommercialAmendment.findFirst({
      where: {
        id: input.amendmentId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
      },
    });
    if (!amendment) {
      throw new HospitalityBookingUnavailableError(
        'Commercial amendment is not available in this organization.',
      );
    }

    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      include: { allocation: true, _count: { select: { guests: true } } },
    });
    if (!booking) throw new HospitalityBookingUnavailableError();
    if (amendment.status === 'APPLIED') {
      return { amendment, booking, applied: false as const };
    }
    if (amendment.status !== 'PREPARED') {
      throw new HospitalityBookingConflictError(
        `Commercial amendment state ${amendment.status.toLowerCase()} cannot be applied.`,
      );
    }
    if (amendment.expiresAt <= now) {
      throw new HospitalityBookingConflictError(
        'Commercial amendment target inventory protection expired before the change could be applied. Reconcile or compensate settlement before preparing another change.',
      );
    }

    for (const lockKey of hospitalityBookingCommercialAllocationLockKeys({
      organizationId: input.organizationId,
      propertyId: amendment.propertyId,
      currentRoomTypeId: amendment.currentRoomTypeId,
      targetRoomTypeId: amendment.targetRoomTypeId,
    })) {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    }

    if (booking.status !== 'CONFIRMED' || !booking.allocation) {
      throw new HospitalityBookingConflictError(
        'Only confirmed bookings with an active allocation can apply a commercial amendment.',
      );
    }
    if (
      booking.propertyId !== amendment.propertyId
      || booking.allocation.propertyId !== booking.propertyId
      || booking.allocation.roomTypeId !== booking.roomTypeId
      || booking.allocation.quantity !== booking.quantity
      || !assertSameDate(booking.allocation.arrivalDate, booking.arrivalDate)
      || !assertSameDate(booking.allocation.departureDate, booking.departureDate)
    ) {
      throw new HospitalityBookingConflictError(
        'Booking allocation is inconsistent with the persisted commercial terms. Reconcile inventory before applying this amendment.',
      );
    }

    const currentAddonSelections = parsePersistedAddonSelections(
      booking.addonSelections,
      'Persisted booking',
    );
    const amendmentCurrentAddonSelections = parsePersistedAddonSelections(
      amendment.currentAddonSelections,
      'Commercial amendment current',
    );
    const targetAddonSelections = parsePersistedAddonSelections(
      amendment.targetAddonSelections,
      'Commercial amendment target',
    );

    const assignment = await transaction.hospitalityRoomTypeRatePlan.findFirst({
      where: {
        organizationId: input.organizationId,
        propertyId: booking.propertyId,
        roomTypeId: amendment.targetRoomTypeId,
        ratePlanId: amendment.targetRatePlanId,
        roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
        ratePlan: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
      },
      select: { roomType: { select: { maxOccupancy: true } } },
    });
    if (!assignment) {
      throw new HospitalityBookingUnavailableError(
        'The commercial amendment target room type and rate plan are no longer active and assigned.',
      );
    }
    if (booking._count.guests > amendment.targetQuantity * assignment.roomType.maxOccupancy) {
      throw new HospitalityBookingConflictError(
        'The current traveler count exceeds the commercial amendment target occupancy.',
      );
    }

    const availabilityRequest = normalizeAvailabilityRequest({
      propertyId: booking.propertyId,
      roomTypeId: amendment.targetRoomTypeId,
      ratePlanId: amendment.targetRatePlanId,
      arrivalDate: formatAvailabilityDate(booking.arrivalDate),
      departureDate: formatAvailabilityDate(booking.departureDate),
      quantity: amendment.targetQuantity,
    });
    const restrictions = await transaction.hospitalityRestriction.findMany({
      where: {
        organizationId: input.organizationId,
        propertyId: booking.propertyId,
        ratePlanId: amendment.targetRatePlanId,
        status: 'ACTIVE',
        startDate: { lte: booking.departureDate },
        endDate: { gte: booking.arrivalDate },
        OR: [{ roomTypeId: null }, { roomTypeId: amendment.targetRoomTypeId }],
      },
      select: {
        startDate: true,
        endDate: true,
        minStayNights: true,
        maxStayNights: true,
        closedToArrival: true,
        closedToDeparture: true,
      },
    });
    const restrictionResult = evaluateAvailabilityRestrictions({
      arrivalDate: availabilityRequest.arrivalDate,
      departureDate: availabilityRequest.departureDate,
      stayNights: availabilityRequest.stayNights,
      restrictions,
    });
    if (!restrictionResult.allowed) {
      throw new HospitalityBookingUnavailableError(
        `Commercial amendment target violates booking restrictions: ${restrictionResult.reasons.join(', ')}.`,
      );
    }

    const [physicalCapacity, windows, competingHolds, otherAllocations] = await Promise.all([
      transaction.hospitalityRoom.count({
        where: {
          organizationId: input.organizationId,
          propertyId: booking.propertyId,
          roomTypeId: amendment.targetRoomTypeId,
          status: 'ACTIVE',
        },
      }),
      transaction.hospitalityAvailabilityWindow.findMany({
        where: {
          organizationId: input.organizationId,
          propertyId: booking.propertyId,
          roomTypeId: amendment.targetRoomTypeId,
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
          roomTypeId: amendment.targetRoomTypeId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
          arrivalDate: { lt: booking.departureDate },
          departureDate: { gt: booking.arrivalDate },
          ...(amendment.targetHoldId ? { id: { not: amendment.targetHoldId } } : {}),
        },
        select: { arrivalDate: true, departureDate: true, quantity: true },
      }),
      transaction.hospitalityBookingAllocation.findMany({
        where: {
          organizationId: input.organizationId,
          propertyId: booking.propertyId,
          roomTypeId: amendment.targetRoomTypeId,
          bookingId: { not: booking.id },
          arrivalDate: { lt: booking.departureDate },
          departureDate: { gt: booking.arrivalDate },
          booking: { is: { status: { not: 'CANCELLED' } } },
        },
        select: { arrivalDate: true, departureDate: true, quantity: true },
      }),
    ]);
    const targetCapacity = calculateAvailabilityHoldCapacity({
      physicalCapacity,
      arrivalDate: availabilityRequest.arrivalDate,
      departureDate: availabilityRequest.departureDate,
      windows,
      holds: competingHolds,
      allocations: otherAllocations,
    });
    if (targetCapacity.sellableUnits < amendment.targetQuantity) {
      throw new HospitalityBookingUnavailableError(
        'Commercial amendment target no longer has enough sellable inventory for the booking.',
      );
    }

    const targetChange = {
      roomTypeId: amendment.targetRoomTypeId,
      ratePlanId: amendment.targetRatePlanId,
      quantity: amendment.targetQuantity,
      addonSelections: targetAddonSelections,
      idempotencyKey: amendment.idempotencyKey,
    };
    const targetSelectionFingerprint = hospitalityBookingCommercialModificationFingerprint(targetChange);
    const expectedProtectionQuantity = hospitalityCommercialAmendmentProtectionQuantity({
      currentRoomTypeId: amendment.currentRoomTypeId,
      currentQuantity: amendment.currentQuantity,
      targetRoomTypeId: amendment.targetRoomTypeId,
      targetQuantity: amendment.targetQuantity,
    });

    if (amendment.targetHoldId) {
      const expectedHoldIdempotencyKey = hospitalityCommercialAmendmentHoldIdempotencyKey({
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey: amendment.idempotencyKey,
        adjustmentFingerprint: amendment.adjustmentFingerprint,
      });
      const hold = await transaction.hospitalityAvailabilityHold.findFirst({
        where: {
          id: amendment.targetHoldId,
          organizationId: input.organizationId,
        },
      });
      if (
        !hold
        || hold.status !== 'ACTIVE'
        || hold.idempotencyKey !== expectedHoldIdempotencyKey
        || hold.expiresAt <= now
        || hold.expiresAt.getTime() !== amendment.expiresAt.getTime()
        || hold.propertyId !== booking.propertyId
        || hold.roomTypeId !== amendment.targetRoomTypeId
        || hold.ratePlanId !== amendment.targetRatePlanId
        || hold.quantity !== amendment.protectionQuantity
        || !assertSameDate(hold.arrivalDate, booking.arrivalDate)
        || !assertSameDate(hold.departureDate, booking.departureDate)
      ) {
        throw new HospitalityBookingConflictError(
          'Commercial amendment target inventory protection is no longer valid. Reconcile settlement before retrying the change.',
        );
      }
    }

    let latestPrice;
    try {
      latestPrice = await quoteHospitalityPriceFromReader({
        reader: transaction,
        organizationId: input.organizationId,
        request: {
          propertyId: booking.propertyId,
          roomTypeId: amendment.targetRoomTypeId,
          ratePlanId: amendment.targetRatePlanId,
          arrivalDate: formatAvailabilityDate(booking.arrivalDate),
          departureDate: formatAvailabilityDate(booking.departureDate),
          quantity: amendment.targetQuantity,
        },
        addonSelections: targetAddonSelections,
      });
    } catch (error) {
      if (error instanceof HospitalityTransactionalPricingUnavailableError) {
        throw new HospitalityBookingUnavailableError(error.message);
      }
      throw error;
    }

    const bookingPrice = priceSnapshot(booking);
    const freshTargetPrice = quotePriceSnapshot(latestPrice);
    try {
      assertHospitalityCommercialAmendmentApplyConsistency({
        bookingId: booking.id,
        booking: {
          updatedAt: booking.updatedAt.toISOString(),
          roomTypeId: booking.roomTypeId,
          ratePlanId: booking.ratePlanId,
          quantity: booking.quantity,
          addonSelections: currentAddonSelections,
          price: bookingPrice,
        },
        amendment: {
          bookingVersion: amendment.bookingVersion.toISOString(),
          currentRoomTypeId: amendment.currentRoomTypeId,
          currentRatePlanId: amendment.currentRatePlanId,
          currentQuantity: amendment.currentQuantity,
          currentAddonSelections: amendmentCurrentAddonSelections,
          targetRoomTypeId: amendment.targetRoomTypeId,
          targetRatePlanId: amendment.targetRatePlanId,
          targetQuantity: amendment.targetQuantity,
          targetAddonSelections,
          selectionFingerprint: amendment.selectionFingerprint,
          adjustmentFingerprint: amendment.adjustmentFingerprint,
          direction: amendment.direction,
          deltaMinor: amendment.deltaMinor.toString(),
          before: amendmentBeforePrice(amendment),
          after: amendmentAfterPrice(amendment),
          protectionQuantity: amendment.protectionQuantity,
          targetHoldId: amendment.targetHoldId,
        },
        freshTargetPrice,
        targetSelectionFingerprint,
        expectedProtectionQuantity,
      });
    } catch (error) {
      mapApplyConsistencyError(error);
    }

    const transactions = await transaction.paymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: booking.id },
      select: {
        commercialAmendmentId: true,
        kind: true,
        status: true,
        providerCode: true,
        providerReference: true,
        sourceProviderReference: true,
        currency: true,
        amountMinor: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const settlement = deriveHospitalityCommercialAmendmentSettlementState({
      amendmentId: amendment.id,
      direction: amendment.direction,
      paymentProviderCode: amendment.paymentProviderCode,
      currency: amendment.currency,
      beforeTotalMinor: amendment.beforeTotalMinor,
      afterTotalMinor: amendment.afterTotalMinor,
      deltaMinor: amendment.deltaMinor,
      transactions,
    });
    if (!settlement.readyToApply) {
      throw new HospitalityBookingConflictError(settlementConflictMessage(settlement));
    }

    const beforeData = {
      amendmentId: amendment.id,
      roomTypeId: booking.roomTypeId,
      ratePlanId: booking.ratePlanId,
      quantity: booking.quantity,
      addonSelections: booking.addonSelections,
      paymentStatus: booking.paymentStatus,
      ...bookingPrice,
    };
    const updatedBooking = await transaction.hospitalityBooking.update({
      where: { id: booking.id },
      data: {
        roomTypeId: amendment.targetRoomTypeId,
        ratePlanId: amendment.targetRatePlanId,
        quantity: amendment.targetQuantity,
        addonSelections: targetAddonSelections,
        accommodationSubtotalMinor: BigInt(freshTargetPrice.accommodationSubtotalMinor),
        taxTotalMinor: BigInt(freshTargetPrice.taxTotalMinor),
        feeTotalMinor: BigInt(freshTargetPrice.feeTotalMinor),
        addonTotalMinor: BigInt(freshTargetPrice.addonTotalMinor),
        totalMinor: BigInt(freshTargetPrice.totalMinor),
        pricingFingerprint: freshTargetPrice.pricingFingerprint,
        paymentStatus: 'PAID',
      },
    });
    await transaction.hospitalityBookingAllocation.update({
      where: {
        organizationId_bookingId: {
          organizationId: input.organizationId,
          bookingId: booking.id,
        },
      },
      data: {
        roomTypeId: amendment.targetRoomTypeId,
        quantity: amendment.targetQuantity,
      },
    });
    if (amendment.targetHoldId) {
      await releaseHospitalityAvailabilityHoldInTransaction({
        transaction,
        organizationId: input.organizationId,
        holdId: amendment.targetHoldId,
        now,
      });
    }
    const updatedAmendment = await transaction.hospitalityBookingCommercialAmendment.update({
      where: { id: amendment.id },
      data: { status: 'APPLIED', appliedAt: now, endedAt: now },
    });

    const afterData = {
      amendmentId: amendment.id,
      roomTypeId: updatedBooking.roomTypeId,
      ratePlanId: updatedBooking.ratePlanId,
      quantity: updatedBooking.quantity,
      addonSelections: updatedBooking.addonSelections,
      paymentStatus: updatedBooking.paymentStatus,
      currency: updatedBooking.currency,
      accommodationSubtotalMinor: updatedBooking.accommodationSubtotalMinor.toString(),
      taxTotalMinor: updatedBooking.taxTotalMinor.toString(),
      feeTotalMinor: updatedBooking.feeTotalMinor.toString(),
      addonTotalMinor: updatedBooking.addonTotalMinor.toString(),
      totalMinor: updatedBooking.totalMinor.toString(),
      pricingFingerprint: updatedBooking.pricingFingerprint,
      adjustmentFingerprint: amendment.adjustmentFingerprint,
      settlementProviderCode: amendment.paymentProviderCode,
      settledAdjustmentMinor: settlement.settledAdjustmentMinor.toString(),
      netSettledMinor: settlement.netSettledMinor.toString(),
    };
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.commercial-amendment.applied',
        resourceType: 'hospitality-booking',
        resourceId: booking.id,
        beforeData,
        afterData,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.commercial-amendment.applied',
        resourceType: 'hospitality-booking-commercial-amendment',
        resourceId: amendment.id,
        beforeData: { status: amendment.status },
        afterData: {
          bookingId: booking.id,
          status: updatedAmendment.status,
          appliedAt: now.toISOString(),
          adjustmentFingerprint: amendment.adjustmentFingerprint,
          targetHoldId: amendment.targetHoldId,
        },
      },
    });

    return {
      amendment: updatedAmendment,
      booking: updatedBooking,
      applied: true as const,
      settlement,
    };
  }, { isolationLevel: 'Serializable' });
}
