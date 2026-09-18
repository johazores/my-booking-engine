import type { Prisma } from '../../generated/prisma/client.ts';

import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import {
  buildRentalPricingEvidence,
  RentalAvailabilityIntegrityError,
} from '../inventory/rental-availability-domain.ts';
import { findOverdueRentalCustodyUnitIds } from '../inventory/rental-custody-availability.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import { deriveRentalPaymentSettlement } from '../payments/rental-payment-domain.ts';
import { readRentalPaymentSettlementHistory } from '../payments/rental-payment-history.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  buildRentalBookingCommercialAmendmentIdempotencyKey,
  buildRentalBookingCommercialAmendmentReviewFingerprint,
  normalizeRentalBookingCommercialAmendmentPreparationInput,
  rentalBookingCommercialAmendmentDirection,
  rentalBookingCommercialAmendmentExpiresAt,
  type RentalBookingCommercialAmendmentPreparationInput,
} from './rental-booking-commercial-amendment-domain.ts';
import {
  buildRentalBookingRescheduleCommercialImpact,
  isRentalBookingCustodyExtensionTarget,
  rentalBookingLockKey,
  type RentalBookingRescheduleMode,
} from './rental-booking-reschedule-domain.ts';
import { classifyRentalBookingWriteError } from './rental-booking-write-errors.ts';

export class RentalBookingCommercialAmendmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingCommercialAmendmentConflictError';
  }
}

export class RentalBookingCommercialAmendmentUnavailableError extends Error {
  constructor(message = 'Rental commercial amendment is not available in this organization.') {
    super(message);
    this.name = 'RentalBookingCommercialAmendmentUnavailableError';
  }
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function runRentalCommercialAmendmentWrite<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE') {
        throw new RentalBookingCommercialAmendmentConflictError(
          'Rental commercial amendment could not be serialized after bounded retries.',
        );
      }
      if (disposition === 'CONFLICT') {
        throw new RentalBookingCommercialAmendmentConflictError(
          'Rental commercial amendment no longer satisfies the durable tenant, inventory, settlement, or lifecycle contract.',
        );
      }
      throw error;
    }
  }
  throw new RentalBookingCommercialAmendmentConflictError(
    'Rental commercial amendment could not be serialized.',
  );
}

async function expirePreparedAmendment(input: Readonly<{
  transaction: Prisma.TransactionClient;
  organizationId: string;
  actorUserId: string;
  amendment: { id: string; bookingId: string; status: string; expiresAt: Date };
  now: Date;
}>) {
  if (input.amendment.status !== 'PREPARED' || input.amendment.expiresAt > input.now) {
    return input.transaction.rentalBookingCommercialAmendment.findFirst({
      where: {
        id: input.amendment.id,
        organizationId: input.organizationId,
        bookingId: input.amendment.bookingId,
      },
    });
  }
  const updated = await input.transaction.rentalBookingCommercialAmendment.updateMany({
    where: {
      id: input.amendment.id,
      organizationId: input.organizationId,
      bookingId: input.amendment.bookingId,
      status: 'PREPARED',
      expiresAt: { lte: input.now },
    },
    data: { status: 'EXPIRED', endedAt: input.now },
  });
  if (updated.count !== 1) {
    throw new RentalBookingCommercialAmendmentConflictError(
      'Rental commercial amendment lifecycle changed while expiry was being recorded.',
    );
  }
  await input.transaction.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'booking.rental.commercial-amendment.expired',
      resourceType: 'rental-booking-commercial-amendment',
      resourceId: input.amendment.id,
      beforeData: { status: 'PREPARED' },
      afterData: {
        status: 'EXPIRED',
        bookingId: input.amendment.bookingId,
        endedAt: input.now.toISOString(),
      },
    },
  });
  return input.transaction.rentalBookingCommercialAmendment.findFirst({
    where: {
      id: input.amendment.id,
      organizationId: input.organizationId,
      bookingId: input.amendment.bookingId,
    },
  });
}

async function expireStalePreparedAmendments(input: Readonly<{
  transaction: Prisma.TransactionClient;
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  now: Date;
}>) {
  const stale = await input.transaction.rentalBookingCommercialAmendment.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      status: 'PREPARED',
      expiresAt: { lte: input.now },
    },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    select: { id: true, bookingId: true, status: true, expiresAt: true },
  });
  for (const amendment of stale) {
    await expirePreparedAmendment({ ...input, amendment });
  }
}

export async function prepareRentalBookingCommercialAmendment(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  target: RentalBookingCommercialAmendmentPreparationInput;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const target = normalizeRentalBookingCommercialAmendmentPreparationInput(input.target);
  const idempotencyKey = buildRentalBookingCommercialAmendmentIdempotencyKey(
    input.bookingId,
    target.reviewFingerprint,
  );

  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);

  return runRentalCommercialAmendmentWrite(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0)
      )
    `;

    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError(
        'Database time authority is unavailable for rental commercial amendment preparation.',
      );
    }

    const existing = await transaction.rentalBookingCommercialAmendment.findFirst({
      where: { organizationId: input.organizationId, idempotencyKey },
    });
    if (existing) {
      if (
        existing.bookingId !== input.bookingId
        || existing.targetStartsOn.getTime() !== target.startsOn.getTime()
        || existing.targetEndsOn.getTime() !== target.endsOn.getTime()
        || existing.reviewFingerprint !== target.reviewFingerprint
      ) {
        throw new RentalBookingCommercialAmendmentConflictError(
          'Rental commercial amendment idempotency authority was already used for a different reviewed change.',
        );
      }
      const current = await expirePreparedAmendment({
        transaction,
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        amendment: existing,
        now: databaseClock.now,
      });
      if (!current) {
        throw new RentalBookingCommercialAmendmentConflictError(
          'Rental commercial amendment evidence disappeared during idempotent replay.',
        );
      }
      return Object.freeze({ amendment: current, idempotent: true });
    }

    await expireStalePreparedAmendments({
      transaction,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      bookingId: input.bookingId,
      now: databaseClock.now,
    });
    const activeAmendment = await transaction.rentalBookingCommercialAmendment.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        status: 'PREPARED',
        expiresAt: { gt: databaseClock.now },
      },
      select: { id: true },
    });
    if (activeAmendment) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'This rental booking already has an active commercial amendment. Cancel it or let it expire before preparing another.',
      );
    }

    const [bookingLocator, allocationLocator, latestSubstitutionLocator] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: {
          id: input.bookingId,
          organizationId: input.organizationId,
          status: 'CONFIRMED',
          cancelledAt: null,
        },
        select: {
          unitId: true,
          fulfillmentEvents: {
            where: { organizationId: input.organizationId },
            select: { id: true, kind: true },
          },
        },
      }),
      transaction.rentalBookingAllocation.findFirst({
        where: { bookingId: input.bookingId, organizationId: input.organizationId },
        select: { unitId: true },
      }),
      transaction.rentalBookingUnitSubstitution.findFirst({
        where: { bookingId: input.bookingId, organizationId: input.organizationId },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: { targetUnitId: true },
      }),
    ]);
    if (
      !bookingLocator
      || !allocationLocator
      || bookingLocator.fulfillmentEvents.some((event) => event.kind === 'RETURNED')
    ) {
      throw new RentalBookingCommercialAmendmentUnavailableError(
        'Only a confirmed, unreturned rental can prepare a commercial date amendment.',
      );
    }
    const effectiveUnitId = latestSubstitutionLocator?.targetUnitId ?? bookingLocator.unitId;
    if (allocationLocator.unitId !== effectiveUnitId) {
      throw new RentalAvailabilityIntegrityError(
        'Rental commercial amendment locator does not match the current effective unit assignment.',
      );
    }

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, effectiveUnitId)}, 0)
      )
    `;

    const [booking, latestReschedule, latestSubstitution] = await Promise.all([
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
                  status: true,
                  unitTypeId: true,
                  locationId: true,
                  unitType: {
                    select: {
                      id: true,
                      status: true,
                      currency: true,
                      defaultDailyRateMinor: true,
                    },
                  },
                  location: { select: { id: true, status: true } },
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
      }),
      transaction.rentalBookingReschedule.findFirst({
        where: { organizationId: input.organizationId, bookingId: input.bookingId },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.rentalBookingUnitSubstitution.findFirst({
        where: { organizationId: input.organizationId, bookingId: input.bookingId },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    if (!booking || !booking.allocation) {
      throw new RentalBookingCommercialAmendmentUnavailableError(
        'Rental booking no longer retains the allocation required for a commercial amendment.',
      );
    }

    const pickupEvent = booking.fulfillmentEvents.find((event) => event.kind === 'PICKED_UP') ?? null;
    const returnEvent = booking.fulfillmentEvents.find((event) => event.kind === 'RETURNED') ?? null;
    if (returnEvent) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Returned rentals cannot prepare a date-change commercial amendment.',
      );
    }
    const mode: RentalBookingRescheduleMode = pickupEvent
      ? 'CUSTODY_EXTENSION'
      : 'PRE_PICKUP_RESCHEDULE';
    const sourceStartsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
    const sourceEndsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
    const sourcePricingFingerprint = latestReschedule?.targetPricingFingerprint ?? booking.pricingFingerprint;
    const currentUnitId = latestSubstitution?.targetUnitId ?? booking.unitId;
    const currentUnit = booking.allocation.unit;

    if (
      currentUnitId !== effectiveUnitId
      || booking.allocation.organizationId !== input.organizationId
      || booking.allocation.bookingId !== booking.id
      || booking.allocation.unitId !== currentUnitId
      || currentUnit.id !== currentUnitId
      || booking.allocation.startsOn.getTime() !== sourceStartsOn.getTime()
      || booking.allocation.endsOn.getTime() !== sourceEndsOn.getTime()
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Rental commercial amendment requires the exact effective physical-unit allocation.',
      );
    }
    if (
      currentUnit.status !== 'ACTIVE'
      || currentUnit.unitType.status !== 'ACTIVE'
      || !currentUnit.location
      || currentUnit.location.status !== 'ACTIVE'
      || currentUnit.unitTypeId !== booking.unitTypeId
      || currentUnit.unitType.id !== booking.unitTypeId
      || currentUnit.locationId !== booking.locationId
      || currentUnit.location.id !== booking.locationId
    ) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'The effective physical unit is no longer active at its retained operating assignment.',
      );
    }
    if (
      target.startsOn.getTime() === sourceStartsOn.getTime()
      && target.endsOn.getTime() === sourceEndsOn.getTime()
    ) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental commercial amendment target dates must change.',
      );
    }
    if (
      mode === 'CUSTODY_EXTENSION'
      && !isRentalBookingCustodyExtensionTarget({
        sourceStartsOn,
        sourceEndsOn,
        targetStartsOn: target.startsOn,
        targetEndsOn: target.endsOn,
      })
    ) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'A picked-up rental may only prepare a commercial amendment for the same start date and a later committed end date.',
      );
    }

    const [blockOverlap, competingHold, bookingOverlap, overdueCustodyUnitIds, ratePeriods] = await Promise.all([
      transaction.rentalAvailabilityBlock.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: currentUnitId,
          startsOn: { lt: target.endsOn },
          endsOn: { gt: target.startsOn },
        },
        select: { id: true },
      }),
      transaction.rentalAvailabilityHold.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: currentUnitId,
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
          unitId: currentUnitId,
          bookingId: { not: booking.id },
          startsOn: { lt: target.endsOn },
          endsOn: { gt: target.startsOn },
          booking: { is: { organizationId: input.organizationId, status: { not: 'CANCELLED' } } },
        },
        select: { id: true },
      }),
      findOverdueRentalCustodyUnitIds(transaction, {
        organizationId: input.organizationId,
        observedAt: databaseClock.now,
        unitId: currentUnitId,
        excludeBookingId: booking.id,
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
    if (blockOverlap || competingHold || bookingOverlap || overdueCustodyUnitIds.length > 0) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'The reviewed rental target dates now conflict with another inventory commitment.',
      );
    }

    const targetPricing = buildRentalPricingEvidence({
      unitTypeId: booking.unitTypeId,
      currency: currentUnit.unitType.currency,
      startsOn: target.startsOn,
      endsOn: target.endsOn,
      defaultDailyRateMinor: currentUnit.unitType.defaultDailyRateMinor,
      ratePeriods,
    });
    const commercialImpact = buildRentalBookingRescheduleCommercialImpact({
      acceptedCurrency: booking.currency,
      acceptedTotalMinor: booking.totalMinor,
      targetCurrency: targetPricing.currency,
      targetTotalMinor: BigInt(targetPricing.totalMinor),
    });
    if (commercialImpact.kind === 'CURRENCY_CHANGED') {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental pricing currency changed after booking acceptance. Correct pricing configuration before preparing a commercial amendment.',
      );
    }
    if (commercialImpact.kind === 'UNCHANGED' || commercialImpact.deltaMinor === null) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'This target has no price delta and must use the existing price-neutral rental reschedule flow.',
      );
    }

    const expectedReviewFingerprint = buildRentalBookingCommercialAmendmentReviewFingerprint({
      organizationId: input.organizationId,
      bookingId: booking.id,
      bookingUpdatedAt: booking.updatedAt,
      unitId: currentUnitId,
      unitTypeId: booking.unitTypeId,
      locationId: booking.locationId,
      sourceStartsOn,
      sourceEndsOn,
      targetStartsOn: target.startsOn,
      targetEndsOn: target.endsOn,
      currency: targetPricing.currency,
      beforeTotalMinor: booking.totalMinor,
      afterTotalMinor: BigInt(targetPricing.totalMinor),
      sourcePricingFingerprint,
      targetPricingFingerprint: targetPricing.fingerprint,
      mode,
      pickupEventId: pickupEvent?.id ?? null,
    });
    if (expectedReviewFingerprint !== target.reviewFingerprint) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental commercial review is stale. Review the target dates and current price again before preparing the amendment.',
      );
    }

    const paymentHistory = await readRentalPaymentSettlementHistory({
      transaction,
      organizationId: input.organizationId,
      bookingId: booking.id,
    });
    if (!paymentHistory.complete) {
      throw new RentalBookingCommercialAmendmentConflictError(paymentHistory.reason);
    }
    const settlement = deriveRentalPaymentSettlement({
      bookingTotalMinor: booking.totalMinor,
      currency: booking.currency,
      transactions: paymentHistory.transactions,
    });
    if (!settlement.reconciled) {
      throw new RentalBookingCommercialAmendmentConflictError(settlement.reason);
    }
    if (settlement.paymentState !== 'PAID' || settlement.netSettledMinor !== booking.totalMinor) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental commercial amendments require the accepted booking total to be fully reconciled as paid before adjustment authority can be prepared.',
      );
    }

    const direction = rentalBookingCommercialAmendmentDirection({
      beforeTotalMinor: booking.totalMinor,
      afterTotalMinor: BigInt(targetPricing.totalMinor),
    });
    if (
      (commercialImpact.kind === 'INCREASE' && direction !== 'ADDITIONAL_CHARGE')
      || (commercialImpact.kind === 'DECREASE' && direction !== 'REFUND')
    ) {
      throw new RentalAvailabilityIntegrityError(
        'Rental commercial amendment direction does not match the reviewed price delta.',
      );
    }
    const expiresAt = rentalBookingCommercialAmendmentExpiresAt(databaseClock.now);
    const amendment = await transaction.rentalBookingCommercialAmendment.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        idempotencyKey,
        direction,
        mode,
        bookingVersion: booking.updatedAt,
        unitId: currentUnitId,
        unitTypeId: booking.unitTypeId,
        locationId: booking.locationId,
        pickupEventId: pickupEvent?.id ?? null,
        sourceStartsOn,
        sourceEndsOn,
        targetStartsOn: target.startsOn,
        targetEndsOn: target.endsOn,
        currency: booking.currency,
        beforeTotalMinor: booking.totalMinor,
        afterTotalMinor: BigInt(targetPricing.totalMinor),
        deltaMinor: commercialImpact.deltaMinor,
        sourcePricingFingerprint,
        targetPricingFingerprint: targetPricing.fingerprint,
        targetPricingSnapshot: toJsonInput(targetPricing.snapshot),
        reviewFingerprint: expectedReviewFingerprint,
        expiresAt,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.commercial-amendment.prepared',
        resourceType: 'rental-booking-commercial-amendment',
        resourceId: amendment.id,
        afterData: {
          bookingId: booking.id,
          status: amendment.status,
          direction: amendment.direction,
          mode: amendment.mode,
          unitId: amendment.unitId,
          sourceStartsOn: amendment.sourceStartsOn.toISOString(),
          sourceEndsOn: amendment.sourceEndsOn.toISOString(),
          targetStartsOn: amendment.targetStartsOn.toISOString(),
          targetEndsOn: amendment.targetEndsOn.toISOString(),
          currency: amendment.currency,
          beforeTotalMinor: amendment.beforeTotalMinor.toString(),
          afterTotalMinor: amendment.afterTotalMinor.toString(),
          deltaMinor: amendment.deltaMinor.toString(),
          sourcePricingFingerprint: amendment.sourcePricingFingerprint,
          targetPricingFingerprint: amendment.targetPricingFingerprint,
          reviewFingerprint: amendment.reviewFingerprint,
          bookingVersion: amendment.bookingVersion.toISOString(),
          pickupEventId: amendment.pickupEventId,
          expiresAt: amendment.expiresAt.toISOString(),
        },
      },
    });

    return Object.freeze({ amendment, idempotent: false });
  }, { isolationLevel: 'Serializable' }));
}

export async function cancelRentalBookingCommercialAmendment(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');

  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);

  return runRentalCommercialAmendmentWrite(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0)
      )
    `;
    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError(
        'Database time authority is unavailable for rental commercial amendment cancellation.',
      );
    }

    const amendment = await transaction.rentalBookingCommercialAmendment.findFirst({
      where: {
        id: input.amendmentId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
      },
    });
    if (!amendment) throw new RentalBookingCommercialAmendmentUnavailableError();
    if (amendment.status !== 'PREPARED') {
      return Object.freeze({ amendment, idempotent: true });
    }
    if (amendment.expiresAt <= databaseClock.now) {
      const expired = await expirePreparedAmendment({
        transaction,
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        amendment,
        now: databaseClock.now,
      });
      if (!expired) {
        throw new RentalBookingCommercialAmendmentConflictError(
          'Rental commercial amendment disappeared while recording expiry.',
        );
      }
      return Object.freeze({ amendment: expired, idempotent: false });
    }

    const updated = await transaction.rentalBookingCommercialAmendment.updateMany({
      where: {
        id: amendment.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        status: 'PREPARED',
        expiresAt: { gt: databaseClock.now },
      },
      data: { status: 'CANCELLED', endedAt: databaseClock.now },
    });
    if (updated.count !== 1) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental commercial amendment lifecycle changed before cancellation could be recorded.',
      );
    }
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.commercial-amendment.cancelled',
        resourceType: 'rental-booking-commercial-amendment',
        resourceId: amendment.id,
        beforeData: { status: 'PREPARED' },
        afterData: {
          status: 'CANCELLED',
          bookingId: amendment.bookingId,
          endedAt: databaseClock.now.toISOString(),
        },
      },
    });
    const current = await transaction.rentalBookingCommercialAmendment.findFirst({
      where: {
        id: amendment.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
      },
    });
    if (!current) {
      throw new RentalBookingCommercialAmendmentConflictError(
        'Rental commercial amendment evidence disappeared after cancellation.',
      );
    }
    return Object.freeze({ amendment: current, idempotent: false });
  }, { isolationLevel: 'Serializable' }));
}
