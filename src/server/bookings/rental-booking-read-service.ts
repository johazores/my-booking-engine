import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveRentalBookingFulfillmentState } from './rental-booking-fulfillment-domain.ts';
import { readBoundedRentalBookingHistory } from './rental-booking-history.ts';

export class RentalBookingUnavailableError extends Error {
  constructor() {
    super('Rental booking is not available in this organization.');
    this.name = 'RentalBookingUnavailableError';
  }
}

export class RentalBookingHistoryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingHistoryUnavailableError';
  }
}

export type RentalBookingListStatus = 'ALL' | 'CONFIRMED' | 'CANCELLED';

function normalizePagination(page: number, pageSize: number) {
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 25;
  return { page: safePage, pageSize: safePageSize };
}

function compareAppliedHistory(
  left: Readonly<{ appliedAt: Date; createdAt: Date; id: string }>,
  right: Readonly<{ appliedAt: Date; createdAt: Date; id: string }>,
) {
  return left.appliedAt.getTime() - right.appliedAt.getTime()
    || left.createdAt.getTime() - right.createdAt.getTime()
    || left.id.localeCompare(right.id);
}

const effectiveAllocationInclude = {
  unit: { select: { id: true, code: true, name: true, status: true, locationId: true, unitTypeId: true } },
} satisfies Prisma.RentalBookingAllocationInclude;

const rentalBookingBaseInclude = {
  allocation: { include: effectiveAllocationInclude },
  unit: { select: { id: true, code: true, name: true, status: true } },
  unitType: { select: { id: true, code: true, name: true, status: true } },
  location: { select: { id: true, code: true, name: true, city: true, countryCode: true, timeZone: true, status: true } },
} satisfies Prisma.RentalBookingInclude;

const rentalBookingListInclude = {
  ...rentalBookingBaseInclude,
  reschedules: {
    orderBy: [{ appliedAt: 'desc' as const }, { createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: { targetStartsOn: true, targetEndsOn: true },
  },
  fulfillmentEvents: {
    orderBy: [{ occurredAt: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }],
    take: 3,
    select: { kind: true, occurredAt: true },
  },
  earlyReturnRelease: { select: { releasedEndsOn: true } },
} satisfies Prisma.RentalBookingInclude;

const rentalBookingDetailInclude = {
  ...rentalBookingBaseInclude,
  customer: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true, archivedAt: true } },
  hold: { select: { id: true, status: true, expiresAt: true, endedAt: true, idempotencyKey: true } },
  earlyReturnRelease: true,
} satisfies Prisma.RentalBookingInclude;

export async function getRentalBooking(input: Readonly<{ organizationId: string; actorUserId: string; bookingId: string }>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' });

  return db.$transaction(async (transaction) => {
    const booking = await transaction.rentalBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      include: rentalBookingDetailInclude,
    });
    if (!booking) throw new RentalBookingUnavailableError();

    const [rescheduleHistory, substitutionHistory, fulfillmentEvents] = await Promise.all([
      readBoundedRentalBookingHistory({
        label: 'Rental booking reschedule history',
        readPage: (cursorId, take) => transaction.rentalBookingReschedule.findMany({
          where: { bookingId: input.bookingId, organizationId: input.organizationId },
          orderBy: { id: 'asc' },
          take,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        }),
      }),
      readBoundedRentalBookingHistory({
        label: 'Rental booking unit-substitution history',
        readPage: (cursorId, take) => transaction.rentalBookingUnitSubstitution.findMany({
          where: { bookingId: input.bookingId, organizationId: input.organizationId },
          orderBy: { id: 'asc' },
          take,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
          include: {
            sourceUnit: { select: { id: true, code: true, name: true } },
            targetUnit: { select: { id: true, code: true, name: true } },
          },
        }),
      }),
      transaction.rentalBookingFulfillmentEvent.findMany({
        where: { bookingId: input.bookingId, organizationId: input.organizationId },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: 3,
      }),
    ]);

    if (!rescheduleHistory.complete) throw new RentalBookingHistoryUnavailableError(rescheduleHistory.reason);
    if (!substitutionHistory.complete) throw new RentalBookingHistoryUnavailableError(substitutionHistory.reason);

    const reschedules = [...rescheduleHistory.rows].sort(compareAppliedHistory);
    const unitSubstitutions = [...substitutionHistory.rows].sort(compareAppliedHistory);

    return Object.freeze({
      ...booking,
      reschedules: Object.freeze(reschedules),
      unitSubstitutions: Object.freeze(unitSubstitutions),
      fulfillmentEvents: Object.freeze(fulfillmentEvents),
      fulfillment: deriveRentalBookingFulfillmentState(fulfillmentEvents),
    });
  }, { isolationLevel: 'RepeatableRead' });
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

  return db.$transaction(async (transaction) => {
    const total = await transaction.rentalBooking.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
    const page = Math.min(pagination.page, totalPages);
    const bookingRows = await transaction.rentalBooking.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      include: rentalBookingListInclude,
    });
    const bookings = bookingRows.map((booking) => Object.freeze({
      ...booking,
      fulfillment: deriveRentalBookingFulfillmentState(booking.fulfillmentEvents),
    }));

    return Object.freeze({
      bookings: Object.freeze(bookings),
      total,
      page,
      pageSize: pagination.pageSize,
      totalPages,
    });
  }, { isolationLevel: 'RepeatableRead' });
}
