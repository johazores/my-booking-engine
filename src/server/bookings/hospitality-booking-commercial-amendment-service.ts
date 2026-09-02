import type { Prisma } from '../../generated/prisma/client.ts';
import { hospitalityAvailabilityAllocationLockKey } from '../availability/availability-allocation-lock.ts';
import {
  createHospitalityAvailabilityHoldInTransaction,
  releaseHospitalityAvailabilityHoldInTransaction,
} from '../availability/hospitality-availability-hold-core.ts';
import {
  evaluateAvailabilityRestrictions,
  formatAvailabilityDate,
  normalizeAvailabilityRequest,
} from '../availability/availability-domain.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { deriveBookingRefundAvailability } from '../payments/payment-refund-availability-domain.ts';
import {
  normalizeHospitalityAddonSelections,
  type HospitalityAddonSelectionInput,
} from '../pricing/hospitality-addon-domain.ts';
import { quoteHospitalityPriceFromReader } from '../pricing/hospitality-transactional-pricing.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  createHospitalityBookingCommercialAdjustmentPreview,
  type HospitalityBookingCommercialPriceSnapshot,
} from './booking-commercial-adjustment-domain.ts';
import {
  hospitalityCommercialAmendmentExpiresAt,
  hospitalityCommercialAmendmentHoldIdempotencyKey,
  hospitalityCommercialAmendmentProtectionQuantity,
  normalizeHospitalityCommercialAdjustmentFingerprint,
} from './booking-commercial-amendment-domain.ts';
import {
  hospitalityBookingCommercialAllocationLockKeys,
  hospitalityBookingCommercialModificationFingerprint,
  normalizeHospitalityBookingCommercialModificationInput,
  type HospitalityBookingCommercialModificationInput,
} from './booking-commercial-modification-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import {
  HospitalityBookingConflictError,
  HospitalityBookingPriceChangedError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-service.ts';

type ExpirableAmendment = {
  id: string;
  bookingId: string;
  targetHoldId: string | null;
};

async function expirePreparedAmendment(input: {
  transaction: Prisma.TransactionClient;
  amendment: ExpirableAmendment;
  organizationId: string;
  actorUserId: string;
  now: Date;
}) {
  if (input.amendment.targetHoldId) {
    await releaseHospitalityAvailabilityHoldInTransaction({
      transaction: input.transaction,
      organizationId: input.organizationId,
      holdId: input.amendment.targetHoldId,
      now: input.now,
    });
  }
  const updated = await input.transaction.hospitalityBookingCommercialAmendment.update({
    where: { id: input.amendment.id },
    data: { status: 'EXPIRED', endedAt: input.now },
  });
  await input.transaction.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'booking.commercial-amendment.expired',
      resourceType: 'hospitality-booking-commercial-amendment',
      resourceId: input.amendment.id,
      beforeData: { status: 'PREPARED' },
      afterData: {
        status: 'EXPIRED',
        bookingId: input.amendment.bookingId,
        endedAt: input.now.toISOString(),
      },
    },
  });
  return updated;
}

async function expirePreparedAmendments(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  actorUserId: string;
  now: Date;
}) {
  const stale = await input.transaction.hospitalityBookingCommercialAmendment.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      status: 'PREPARED',
      expiresAt: { lte: input.now },
    },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    select: { id: true, bookingId: true, targetHoldId: true },
  });
  for (const amendment of stale) {
    await expirePreparedAmendment({
      transaction: input.transaction,
      amendment,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      now: input.now,
    });
  }
}

export async function prepareHospitalityBookingCommercialAmendment(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  change: HospitalityBookingCommercialModificationInput;
  adjustmentFingerprint: unknown;
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
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:manage',
  });

  const change = normalizeHospitalityBookingCommercialModificationInput(input.change);
  const expectedAdjustmentFingerprint = normalizeHospitalityCommercialAdjustmentFingerprint(input.adjustmentFingerprint);
  const selectionFingerprint = hospitalityBookingCommercialModificationFingerprint(change);
  const now = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;

    const existing = await transaction.hospitalityBookingCommercialAmendment.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: change.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        existing.bookingId !== input.bookingId
        || existing.adjustmentFingerprint !== expectedAdjustmentFingerprint
        || existing.selectionFingerprint !== selectionFingerprint
      ) {
        throw new HospitalityBookingConflictError(
          'Commercial amendment idempotency key was already used for a different reviewed change.',
        );
      }
      if (existing.status === 'PREPARED' && existing.expiresAt <= now) {
        return expirePreparedAmendment({
          transaction,
          amendment: existing,
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          now,
        });
      }
      return existing;
    }

    const initial = await transaction.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { id: true, propertyId: true, roomTypeId: true },
    });
    if (!initial) throw new HospitalityBookingUnavailableError();

    const staleLockScopes = await transaction.hospitalityBookingCommercialAmendment.findMany({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        status: 'PREPARED',
        expiresAt: { lte: now },
        targetHoldId: { not: null },
      },
      select: { propertyId: true, targetRoomTypeId: true },
    });
    const allocationLockKeys = [...new Set([
      ...hospitalityBookingCommercialAllocationLockKeys({
        organizationId: input.organizationId,
        propertyId: initial.propertyId,
        currentRoomTypeId: initial.roomTypeId,
        targetRoomTypeId: change.roomTypeId,
      }),
      ...staleLockScopes.map((amendment) => hospitalityAvailabilityAllocationLockKey({
        organizationId: input.organizationId,
        propertyId: amendment.propertyId,
        roomTypeId: amendment.targetRoomTypeId,
      })),
    ])].sort();
    for (const lockKey of allocationLockKeys) {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    }

    await expirePreparedAmendments({
      transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      actorUserId: input.actorUserId,
      now,
    });
    const activeAmendment = await transaction.hospitalityBookingCommercialAmendment.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        status: 'PREPARED',
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (activeAmendment) {
      throw new HospitalityBookingConflictError(
        'This booking already has an active commercial amendment. Cancel or finish it before preparing another change.',
      );
    }

    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      include: { allocation: true, _count: { select: { guests: true } } },
    });
    if (!booking) throw new HospitalityBookingUnavailableError();
    if (booking.status !== 'CONFIRMED' || !booking.allocation) {
      throw new HospitalityBookingConflictError(
        'Only confirmed bookings with an active allocation can prepare a commercial amendment.',
      );
    }
    if (
      booking.allocation.propertyId !== booking.propertyId
      || booking.allocation.roomTypeId !== booking.roomTypeId
      || booking.allocation.quantity !== booking.quantity
    ) {
      throw new HospitalityBookingConflictError(
        'Booking allocation is inconsistent with the persisted commercial terms. Reconcile inventory before changing this booking.',
      );
    }
    if (booking.paymentStatus !== 'PAID') {
      throw new HospitalityBookingConflictError(
        'Commercial payment adjustments are currently prepared only from fully paid bookings with reconciled settlement history.',
      );
    }

    const paymentTransactions = await transaction.paymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: booking.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (paymentTransactions.some((payment) => payment.status === 'PENDING' || payment.status === 'AMBIGUOUS')) {
      throw new HospitalityBookingConflictError(
        'Booking has an unresolved payment operation. Reconcile it before preparing commercial terms.',
      );
    }
    const settlement = deriveBookingRefundAvailability({
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      currency: booking.currency,
      totalMinor: booking.totalMinor,
      transactions: paymentTransactions,
    });
    if (!settlement.available || settlement.refundableMinor !== booking.totalMinor) {
      throw new HospitalityBookingConflictError(
        settlement.available
          ? 'Settled payment history does not reconcile to the authoritative booking total.'
          : settlement.reason,
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
      throw new HospitalityBookingUnavailableError(
        'The requested room type and rate plan are no longer active and assigned.',
      );
    }
    if (booking._count.guests > change.quantity * assignment.roomType.maxOccupancy) {
      throw new HospitalityBookingConflictError(
        'The current traveler count exceeds the requested room quantity and room-type occupancy.',
      );
    }

    const availabilityRequest = normalizeAvailabilityRequest({
      propertyId: booking.propertyId,
      roomTypeId: change.roomTypeId,
      ratePlanId: change.ratePlanId,
      arrivalDate: formatAvailabilityDate(booking.arrivalDate),
      departureDate: formatAvailabilityDate(booking.departureDate),
      quantity: change.quantity,
    });
    const restrictions = await transaction.hospitalityRestriction.findMany({
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
    });
    const restrictionResult = evaluateAvailabilityRestrictions({
      arrivalDate: availabilityRequest.arrivalDate,
      departureDate: availabilityRequest.departureDate,
      stayNights: availabilityRequest.stayNights,
      restrictions,
    });
    if (!restrictionResult.allowed) {
      throw new HospitalityBookingUnavailableError(
        `Requested commercial terms violate booking restrictions: ${restrictionResult.reasons.join(', ')}.`,
      );
    }

    if (!Array.isArray(booking.addonSelections)) {
      throw new HospitalityBookingConflictError(
        'Persisted booking add-on selections are invalid. Reconcile the booking before changing commercial terms.',
      );
    }
    let currentAddonSelections;
    try {
      currentAddonSelections = normalizeHospitalityAddonSelections(
        booking.addonSelections as HospitalityAddonSelectionInput[],
      );
    } catch {
      throw new HospitalityBookingConflictError(
        'Persisted booking add-on selections are invalid. Reconcile the booking before changing commercial terms.',
      );
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
    const before: HospitalityBookingCommercialPriceSnapshot = {
      currency: booking.currency,
      accommodationSubtotalMinor: booking.accommodationSubtotalMinor.toString(),
      taxTotalMinor: booking.taxTotalMinor.toString(),
      feeTotalMinor: booking.feeTotalMinor.toString(),
      addonTotalMinor: booking.addonTotalMinor.toString(),
      totalMinor: booking.totalMinor.toString(),
      pricingFingerprint: booking.pricingFingerprint,
    };
    const after: HospitalityBookingCommercialPriceSnapshot = {
      currency: latestPrice.currency,
      accommodationSubtotalMinor: latestPrice.accommodationSubtotalMinor,
      taxTotalMinor: latestPrice.taxTotalMinor,
      feeTotalMinor: latestPrice.feeTotalMinor,
      addonTotalMinor: latestPrice.addonTotalMinor,
      totalMinor: latestPrice.totalMinor,
      pricingFingerprint: latestPrice.fingerprint,
    };
    const preview = createHospitalityBookingCommercialAdjustmentPreview({
      bookingId: booking.id,
      bookingVersion: booking.updatedAt.toISOString(),
      selectionFingerprint,
      before,
      after,
    });
    if (preview.adjustmentFingerprint !== expectedAdjustmentFingerprint) {
      throw new HospitalityBookingPriceChangedError(
        'The reviewed commercial adjustment is stale. Review the current price again before preparing the amendment.',
      );
    }
    if (preview.direction === 'NONE') {
      throw new HospitalityBookingConflictError(
        'This change has no price delta and should use the existing zero-delta commercial modification flow.',
      );
    }

    const protectionQuantity = hospitalityCommercialAmendmentProtectionQuantity({
      currentRoomTypeId: booking.roomTypeId,
      currentQuantity: booking.quantity,
      targetRoomTypeId: change.roomTypeId,
      targetQuantity: change.quantity,
    });
    let targetHoldId: string | null = null;
    let expiresAt = hospitalityCommercialAmendmentExpiresAt(now);
    if (protectionQuantity > 0) {
      const hold = await createHospitalityAvailabilityHoldInTransaction({
        transaction,
        organizationId: input.organizationId,
        now,
        hold: {
          idempotencyKey: hospitalityCommercialAmendmentHoldIdempotencyKey({
            organizationId: input.organizationId,
            bookingId: booking.id,
            idempotencyKey: change.idempotencyKey,
            adjustmentFingerprint: preview.adjustmentFingerprint,
          }),
          request: {
            propertyId: booking.propertyId,
            roomTypeId: change.roomTypeId,
            ratePlanId: change.ratePlanId,
            arrivalDate: formatAvailabilityDate(booking.arrivalDate),
            departureDate: formatAvailabilityDate(booking.departureDate),
            quantity: protectionQuantity,
          },
        },
      });
      if (hold.hold.status !== 'ACTIVE' || hold.hold.expiresAt <= now) {
        throw new HospitalityBookingConflictError(
          'Target inventory protection is no longer active. Review the commercial change again.',
        );
      }
      targetHoldId = hold.hold.id;
      expiresAt = hold.hold.expiresAt;
    }

    const amendment = await transaction.hospitalityBookingCommercialAmendment.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey: change.idempotencyKey,
        direction: preview.direction,
        bookingVersion: booking.updatedAt,
        selectionFingerprint,
        adjustmentFingerprint: preview.adjustmentFingerprint,
        paymentProviderCode: settlement.providerCode,
        propertyId: booking.propertyId,
        currentRoomTypeId: booking.roomTypeId,
        currentRatePlanId: booking.ratePlanId,
        currentQuantity: booking.quantity,
        currentAddonSelections,
        targetRoomTypeId: change.roomTypeId,
        targetRatePlanId: change.ratePlanId,
        targetQuantity: change.quantity,
        targetAddonSelections: change.addonSelections,
        currency: preview.currency,
        beforeAccommodationSubtotalMinor: BigInt(preview.before.accommodationSubtotalMinor),
        beforeTaxTotalMinor: BigInt(preview.before.taxTotalMinor),
        beforeFeeTotalMinor: BigInt(preview.before.feeTotalMinor),
        beforeAddonTotalMinor: BigInt(preview.before.addonTotalMinor),
        beforeTotalMinor: BigInt(preview.before.totalMinor),
        beforePricingFingerprint: preview.before.pricingFingerprint,
        afterAccommodationSubtotalMinor: BigInt(preview.after.accommodationSubtotalMinor),
        afterTaxTotalMinor: BigInt(preview.after.taxTotalMinor),
        afterFeeTotalMinor: BigInt(preview.after.feeTotalMinor),
        afterAddonTotalMinor: BigInt(preview.after.addonTotalMinor),
        afterTotalMinor: BigInt(preview.after.totalMinor),
        afterPricingFingerprint: preview.after.pricingFingerprint,
        deltaMinor: BigInt(preview.deltaMinor),
        targetHoldId,
        protectionQuantity,
        expiresAt,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.commercial-amendment.prepared',
        resourceType: 'hospitality-booking-commercial-amendment',
        resourceId: amendment.id,
        afterData: {
          bookingId: booking.id,
          status: amendment.status,
          direction: amendment.direction,
          currency: amendment.currency,
          deltaMinor: amendment.deltaMinor.toString(),
          paymentProviderCode: amendment.paymentProviderCode,
          adjustmentFingerprint: amendment.adjustmentFingerprint,
          bookingVersion: amendment.bookingVersion.toISOString(),
          targetHoldId: amendment.targetHoldId,
          protectionQuantity: amendment.protectionQuantity,
          expiresAt: amendment.expiresAt.toISOString(),
        },
      },
    });
    return amendment;
  }, { isolationLevel: 'Serializable' });
}

export async function cancelHospitalityBookingCommercialAmendment(input: {
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
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'booking:manage',
  });
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:manage',
  });
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
    if (amendment.status === 'CANCELLED' || amendment.status === 'EXPIRED') return amendment;
    if (amendment.status !== 'PREPARED') {
      throw new HospitalityBookingConflictError(
        `Commercial amendment state ${amendment.status.toLowerCase()} cannot be cancelled.`,
      );
    }

    if (amendment.targetHoldId) {
      await releaseHospitalityAvailabilityHoldInTransaction({
        transaction,
        organizationId: input.organizationId,
        holdId: amendment.targetHoldId,
        now,
      });
    }
    const nextStatus = amendment.expiresAt <= now ? 'EXPIRED' as const : 'CANCELLED' as const;
    const updated = await transaction.hospitalityBookingCommercialAmendment.update({
      where: { id: amendment.id },
      data: { status: nextStatus, endedAt: now },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: nextStatus === 'EXPIRED'
          ? 'booking.commercial-amendment.expired'
          : 'booking.commercial-amendment.cancelled',
        resourceType: 'hospitality-booking-commercial-amendment',
        resourceId: amendment.id,
        beforeData: { status: amendment.status },
        afterData: {
          status: nextStatus,
          bookingId: amendment.bookingId,
          endedAt: now.toISOString(),
        },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
