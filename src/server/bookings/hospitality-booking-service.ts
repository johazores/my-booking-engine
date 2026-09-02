import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import type { HospitalityBookingConfirmationInput, HospitalityBookingGuestInput } from './booking-domain.ts';
import {
  confirmHospitalityBookingFromHoldInTransaction,
  createHospitalityBookingAuditData,
  HospitalityBookingConflictError,
  HospitalityBookingPriceChangedError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-confirmation-core.ts';

export {
  HospitalityBookingConflictError,
  HospitalityBookingPriceChangedError,
  HospitalityBookingUnavailableError,
};

function normalizePagination(page: number, pageSize: number) {
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 25;
  return { page: safePage, pageSize: safePageSize };
}

async function readBookingGuests(reader: typeof db, organizationId: string, bookingId: string) {
  return reader.hospitalityBookingGuest.findMany({
    where: { organizationId, bookingId },
    orderBy: { position: 'asc' },
    select: { firstName: true, lastName: true, email: true },
  });
}

export async function confirmHospitalityBookingFromHold(input: {
  organizationId: string;
  actorUserId: string;
  confirmation: HospitalityBookingConfirmationInput;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' });
  const now = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
    const result = await confirmHospitalityBookingFromHoldInTransaction({
      transaction,
      organizationId: input.organizationId,
      confirmation: input.confirmation,
      now,
    });

    if (result.created) {
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'booking.confirmed',
          resourceType: 'hospitality-booking',
          resourceId: result.booking.id,
          afterData: createHospitalityBookingAuditData(result.booking),
        },
      });
    }

    return result.booking;
  }, { isolationLevel: 'Serializable' });
}

export async function getHospitalityBooking(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' });
  const booking = await db.hospitalityBooking.findFirst({
    where: { id: input.bookingId, organizationId: input.organizationId },
    include: { allocation: true, customer: true, roomType: true, ratePlan: true },
  });
  if (!booking) throw new HospitalityBookingUnavailableError();
  const guests = await readBookingGuests(db, input.organizationId, booking.id);
  return { ...booking, guests };
}

export async function listHospitalityBookings(input: {
  organizationId: string;
  actorUserId: string;
  page?: number;
  pageSize?: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' });
  const pagination = normalizePagination(input.page ?? 1, input.pageSize ?? 25);
  const where = { organizationId: input.organizationId };
  const total = await db.hospitalityBooking.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
  const page = Math.min(pagination.page, totalPages);
  const bookings = await db.hospitalityBooking.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * pagination.pageSize,
    take: pagination.pageSize,
    include: {
      allocation: true,
      customer: { select: { id: true, firstName: true, lastName: true, email: true, status: true } },
      roomType: { select: { id: true, name: true, code: true } },
      ratePlan: { select: { id: true, name: true, code: true } },
    },
  });
  const guestRows = bookings.length === 0 ? [] : await db.hospitalityBookingGuest.findMany({
    where: { organizationId: input.organizationId, bookingId: { in: bookings.map((booking) => booking.id) } },
    orderBy: [{ bookingId: 'asc' }, { position: 'asc' }],
    select: { bookingId: true, firstName: true, lastName: true, email: true },
  });
  const guestsByBooking = new Map<string, HospitalityBookingGuestInput[]>();
  for (const guest of guestRows) {
    const bookingGuests = guestsByBooking.get(guest.bookingId) ?? [];
    bookingGuests.push({ firstName: guest.firstName, lastName: guest.lastName, email: guest.email });
    guestsByBooking.set(guest.bookingId, bookingGuests);
  }
  return { bookings: bookings.map((booking) => ({ ...booking, guests: guestsByBooking.get(booking.id) ?? [] })), total, page, totalPages };
}
