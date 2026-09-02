import {
  ACTIVE_COMMERCIAL_AMENDMENT_CONFLICT_MESSAGE,
  findActiveHospitalityBookingCommercialAmendment,
} from '../bookings/hospitality-booking-commercial-amendment-guard.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveBookingRefundAvailability } from './payment-refund-availability-domain.ts';
import { PaymentUnavailableError } from './payment-service.ts';

export async function getBookingRefundAvailability(input: {
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
    permission: 'payment:manage',
  });

  const now = input.now ?? new Date();
  const [booking, transactions, activeAmendment] = await Promise.all([
    db.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true },
    }),
    db.paymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: input.bookingId },
      select: {
        kind: true,
        status: true,
        providerCode: true,
        providerReference: true,
        currency: true,
        amountMinor: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    findActiveHospitalityBookingCommercialAmendment({
      reader: db,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      now,
    }),
  ]);
  if (!booking) throw new PaymentUnavailableError('Booking is not available in this organization.');
  if (activeAmendment) {
    return { available: false as const, reason: ACTIVE_COMMERCIAL_AMENDMENT_CONFLICT_MESSAGE };
  }

  return deriveBookingRefundAvailability({
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    currency: booking.currency,
    totalMinor: booking.totalMinor,
    transactions,
  });
}
