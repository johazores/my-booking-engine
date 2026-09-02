import { hospitalityAvailabilityAllocationLockKey } from '../availability/availability-allocation-lock.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { bookingCancellationPaymentBlockReason } from './booking-cancellation-domain.ts';
import { assertBookingStateTransition } from './booking-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import { HospitalityBookingConflictError, HospitalityBookingUnavailableError } from './hospitality-booking-service.ts';

export async function cancelHospitalityBooking(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
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
    });
    if (!booking) throw new HospitalityBookingUnavailableError();
    if (booking.status === 'CANCELLED') return booking;

    assertBookingStateTransition(booking.status, 'CANCELLED');
    const paymentBlockReason = bookingCancellationPaymentBlockReason(booking.paymentStatus);
    if (paymentBlockReason) throw new HospitalityBookingConflictError(paymentBlockReason);

    const activePayment = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        kind: { in: ['AUTHORIZATION', 'CAPTURE'] },
        status: 'PENDING',
      },
      select: { id: true },
    });
    if (activePayment) {
      throw new HospitalityBookingConflictError('Booking has a payment in progress. Resolve or fail the payment attempt before cancelling the booking.');
    }

    const cancelled = await transaction.hospitalityBooking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED', cancelledAt: now },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.cancelled',
        resourceType: 'hospitality-booking',
        resourceId: booking.id,
        beforeData: {
          status: booking.status,
          paymentStatus: booking.paymentStatus,
        },
        afterData: {
          status: cancelled.status,
          paymentStatus: cancelled.paymentStatus,
          cancelledAt: cancelled.cancelledAt?.toISOString() ?? null,
        },
      },
    });

    return cancelled;
  }, { isolationLevel: 'Serializable' });
}
