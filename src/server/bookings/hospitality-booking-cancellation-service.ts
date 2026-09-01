import { hospitalityAvailabilityAllocationLockKey } from '../availability/availability-allocation-lock.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { assertBookingStateTransition } from './booking-domain.ts';
import { HospitalityBookingConflictError, HospitalityBookingUnavailableError } from './hospitality-booking-service.ts';

const CANCELLABLE_PAYMENT_STATUSES = new Set(['UNPAID', 'FAILED', 'REFUNDED']);

function bookingCancellationLockKey(organizationId: string, bookingId: string) {
  return `hospitality-booking-cancel:${organizationId}:${bookingId}`;
}

export function canCancelHospitalityBookingPayment(paymentStatus: string) {
  return CANCELLABLE_PAYMENT_STATUSES.has(paymentStatus);
}

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
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bookingCancellationLockKey(input.organizationId, input.bookingId)}, 0))`;

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
    if (!canCancelHospitalityBookingPayment(booking.paymentStatus)) {
      throw new HospitalityBookingConflictError(
        'This booking has an active or settled payment. Complete the required payment release or refund before cancelling the booking.',
      );
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
