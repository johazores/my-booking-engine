import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { RentalAvailabilityIntegrityError } from '../inventory/rental-availability-domain.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import { deriveRentalPaymentSettlement } from '../payments/rental-payment-domain.ts';
import { readRentalPaymentSettlementHistory } from '../payments/rental-payment-history.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { normalizeRentalBookingCancellationReason } from './rental-booking-cancellation-domain.ts';
import { rentalBookingLockKey } from './rental-booking-reschedule-domain.ts';
import { classifyRentalBookingWriteError } from './rental-booking-write-errors.ts';

export class RentalBookingCancellationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingCancellationConflictError';
  }
}

export class RentalBookingCancellationUnavailableError extends Error {
  constructor() {
    super('Rental booking is not available in this organization.');
    this.name = 'RentalBookingCancellationUnavailableError';
  }
}

async function runRentalBookingCancellation<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error);
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE') {
        throw new RentalBookingCancellationConflictError(
          'Rental booking cancellation could not be serialized after bounded retries.',
        );
      }
      if (disposition === 'CONFLICT') {
        throw new RentalBookingCancellationConflictError(
          'Rental booking cancellation no longer satisfies the durable inventory, payment, or lifecycle contract.',
        );
      }
      throw error;
    }
  }
  throw new RentalBookingCancellationConflictError('Rental booking cancellation could not be serialized.');
}

export async function cancelRentalBooking(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  reason?: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');

  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:manage' }),
  ]);
  const cancellationReason = input.reason === undefined
    ? null
    : normalizeRentalBookingCancellationReason(input.reason);

  return runRentalBookingCancellation(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0)
      )
    `;

    const [bookingLocator, allocationLocator, latestSubstitutionLocator] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: { id: input.bookingId, organizationId: input.organizationId },
        select: { unitId: true },
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
    if (!bookingLocator || !allocationLocator) throw new RentalBookingCancellationUnavailableError();
    const effectiveUnitId = latestSubstitutionLocator?.targetUnitId ?? bookingLocator.unitId;
    if (allocationLocator.unitId !== effectiveUnitId) {
      throw new RentalAvailabilityIntegrityError(
        'Rental booking cancellation locator does not match the current effective unit assignment.',
      );
    }

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, effectiveUnitId)}, 0)
      )
    `;

    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError('Database clock is unavailable for rental booking cancellation.');
    }

    const [booking, latestReschedule, latestSubstitution, fulfillmentEvent] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: { id: input.bookingId, organizationId: input.organizationId },
        include: { allocation: true },
      }),
      transaction.rentalBookingReschedule.findFirst({
        where: { bookingId: input.bookingId, organizationId: input.organizationId },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.rentalBookingUnitSubstitution.findFirst({
        where: { bookingId: input.bookingId, organizationId: input.organizationId },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.rentalBookingFulfillmentEvent.findFirst({
        where: { bookingId: input.bookingId, organizationId: input.organizationId },
        select: { id: true, kind: true },
      }),
    ]);
    if (!booking) throw new RentalBookingCancellationUnavailableError();
    const effectiveStartsOn = latestReschedule?.targetStartsOn ?? booking.startsOn;
    const effectiveEndsOn = latestReschedule?.targetEndsOn ?? booking.endsOn;
    const currentUnitId = latestSubstitution?.targetUnitId ?? booking.unitId;
    if (
      currentUnitId !== effectiveUnitId
      || !booking.allocation
      || booking.allocation.organizationId !== input.organizationId
      || booking.allocation.bookingId !== booking.id
      || booking.allocation.unitId !== currentUnitId
      || booking.allocation.startsOn.getTime() !== effectiveStartsOn.getTime()
      || booking.allocation.endsOn.getTime() !== effectiveEndsOn.getTime()
    ) {
      throw new RentalAvailabilityIntegrityError('Rental booking cancellation requires its exact effective physical-unit allocation.');
    }

    if (booking.status === 'CANCELLED') {
      if (!booking.cancelledAt) {
        throw new RentalAvailabilityIntegrityError('Cancelled rental booking is missing its cancellation timestamp.');
      }
      if (fulfillmentEvent) {
        throw new RentalAvailabilityIntegrityError('Cancelled rental booking cannot retain physical-custody evidence.');
      }
      return Object.freeze({ booking, allocation: booking.allocation, idempotent: true });
    }
    if (booking.status !== 'CONFIRMED' || booking.cancelledAt) {
      throw new RentalBookingCancellationConflictError('Only a confirmed rental booking can be cancelled.');
    }
    if (fulfillmentEvent) {
      throw new RentalBookingCancellationConflictError(
        `Rental booking cannot be cancelled after physical custody has started (${fulfillmentEvent.kind}).`,
      );
    }

    const paymentHistory = await readRentalPaymentSettlementHistory({
      transaction,
      organizationId: input.organizationId,
      bookingId: booking.id,
    });
    if (!paymentHistory.complete) {
      throw new RentalBookingCancellationConflictError(`Rental payment history must be reconciled before cancellation. ${paymentHistory.reason}`);
    }
    const paymentSettlement = deriveRentalPaymentSettlement({
      bookingTotalMinor: booking.totalMinor,
      currency: booking.currency,
      transactions: paymentHistory.transactions,
    });
    if (!paymentSettlement.reconciled) {
      throw new RentalBookingCancellationConflictError(`Rental payment history must be reconciled before cancellation. ${paymentSettlement.reason}`);
    }
    if (paymentSettlement.netSettledMinor !== 0n) {
      throw new RentalBookingCancellationConflictError('Refund all settled rental money before cancelling this booking.');
    }

    const cancelled = await transaction.rentalBooking.updateMany({
      where: {
        id: booking.id,
        organizationId: input.organizationId,
        status: 'CONFIRMED',
        cancelledAt: null,
        updatedAt: booking.updatedAt,
        customerId: booking.customerId,
        customerFirstName: booking.customerFirstName,
        customerLastName: booking.customerLastName,
        customerEmail: booking.customerEmail,
        customerPhone: booking.customerPhone,
        holdId: booking.holdId,
        unitId: booking.unitId,
        unitTypeId: booking.unitTypeId,
        locationId: booking.locationId,
        idempotencyKey: booking.idempotencyKey,
        startsOn: booking.startsOn,
        endsOn: booking.endsOn,
        currency: booking.currency,
        totalMinor: booking.totalMinor,
        pricingFingerprint: booking.pricingFingerprint,
        pricingObservedAt: booking.pricingObservedAt,
        authorityFingerprint: booking.authorityFingerprint,
        confirmedAt: booking.confirmedAt,
      },
      data: { status: 'CANCELLED', cancelledAt: databaseClock.now },
    });
    if (cancelled.count !== 1) {
      throw new RentalBookingCancellationConflictError('Rental booking changed before cancellation could be committed.');
    }

    const current = await transaction.rentalBooking.findFirst({
      where: { id: booking.id, organizationId: input.organizationId },
      include: { allocation: true },
    });
    if (!current || current.status !== 'CANCELLED' || !current.cancelledAt || !current.allocation) {
      throw new RentalAvailabilityIntegrityError('Rental booking cancellation did not retain complete lifecycle evidence.');
    }

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.cancelled',
        resourceType: 'rental-booking',
        resourceId: booking.id,
        beforeData: {
          status: booking.status,
          unitId: currentUnitId,
          originalUnitId: booking.unitId,
          startsOn: effectiveStartsOn.toISOString(),
          endsOn: effectiveEndsOn.toISOString(),
          allocationId: booking.allocation.id,
          latestRescheduleId: latestReschedule?.id ?? null,
          latestUnitSubstitutionId: latestSubstitution?.id ?? null,
          paymentState: paymentSettlement.paymentState,
          netSettledMinor: paymentSettlement.netSettledMinor.toString(),
        },
        afterData: {
          status: current.status,
          cancelledAt: current.cancelledAt.toISOString(),
          cancellationReason,
          allocationId: current.allocation.id,
          inventoryProtectionReleased: true,
        },
      },
    });

    return Object.freeze({ booking: current, allocation: current.allocation, idempotent: false });
  }, { isolationLevel: 'Serializable' }));
}
