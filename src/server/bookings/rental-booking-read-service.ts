import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveRentalBookingFulfillmentState } from './rental-booking-fulfillment-domain.ts';

export class RentalBookingUnavailableError extends Error {
  constructor() {
    super('Rental booking is not available in this organization.');
    this.name = 'RentalBookingUnavailableError';
  }
}

export type RentalBookingListStatus = 'ALL' | 'CONFIRMED' | 'CANCELLED';

function normalizePagination(page: number, pageSize: number) {
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 25;
  return { page: safePage, pageSize: safePageSize };
}

const effectiveAllocationInclude = {
  unit: { select: { id: true, code: true, name: true, status: true, locationId: true, unitTypeId: true } },
} satisfies Prisma.RentalBookingAllocationInclude;

const rentalBookingListInclude = {
  allocation: { include: effectiveAllocationInclude },
  unit: { select: { id: true, code: true, name: true, status: true } },
  unitType: { select: { id: true, code: true, name: true, status: true } },
  location: { select: { id: true, code: true, name: true, city: true, countryCode: true, timeZone: true, status: true } },
} satisfies Prisma.RentalBookingInclude;

const rentalBookingDetailInclude = {
  ...rentalBookingListInclude,
  customer: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true, archivedAt: true } },
  hold: { select: { id: true, status: true, expiresAt: true, endedAt: true, idempotencyKey: true } },
} satisfies Prisma.RentalBookingInclude;

export async function getRentalBooking(input: Readonly<{ organizationId: string; actorUserId: string; bookingId: string }>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' });

  const [booking, reschedules, unitSubstitutions, fulfillmentEvents] = await Promise.all([
    db.rentalBooking.findFirst({ where: { id: input.bookingId, organizationId: input.organizationId }, include: rentalBookingDetailInclude }),
    db.rentalBookingReschedule.findMany({
      where: { bookingId: input.bookingId, organizationId: input.organizationId },
      orderBy: [{ appliedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    db.rentalBookingUnitSubstitution.findMany({
      where: { bookingId: input.bookingId, organizationId: input.organizationId },
      orderBy: [{ appliedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      include: { sourceUnit: { select: { id: true, code: true, name: true } }, targetUnit: { select: { id: true, code: true, name: true } } },
    }),
    db.rentalBookingFulfillmentEvent.findMany({
      where: { bookingId: input.bookingId, organizationId: input.organizationId },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  if (!booking) throw new RentalBookingUnavailableError();
  return Object.freeze({
    ...booking,
    reschedules,
    unitSubstitutions,
    fulfillmentEvents,
    fulfillment: deriveRentalBookingFulfillmentState(fulfillmentEvents),
  });
}

export async function listRentalBookings(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  status?: RentalBookingListStatus;
  page?: number;
  pageSize?: number;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' });

  const pagination = normalizePagination(input.page ?? 1, input.pageSize ?? 25);
  const where: Prisma.RentalBookingWhereInput = { organizationId: input.organizationId };
  if (input.status && input.status !== 'ALL') where.status = input.status;

  const total = await db.rentalBooking.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
  const page = Math.min(pagination.page, totalPages);
  const bookings = await db.rentalBooking.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pagination.pageSize,
    take: pagination.pageSize,
    include: rentalBookingListInclude,
  });

  return Object.freeze({ bookings, total, page, pageSize: pagination.pageSize, totalPages });
}
