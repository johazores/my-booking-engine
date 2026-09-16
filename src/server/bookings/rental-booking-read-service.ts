import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveRentalBookingCustodyReadState } from './rental-booking-custody-read-domain.ts';
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
export type RentalBookingListCustody = 'ALL' | 'OVERDUE';

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

function requireDatabaseObservation(databaseClock: readonly Readonly<{ now: Date }>[]) {
  const observedAt = databaseClock[0]?.now;
  if (!(observedAt instanceof Date) || Number.isNaN(observedAt.getTime())) {
    throw new RentalBookingHistoryUnavailableError(
      'Rental booking custody status could not obtain the PostgreSQL observation time.',
    );
  }
  return observedAt;
}

function requireDatabaseCount(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new RentalBookingHistoryUnavailableError(`${label} returned an invalid database count.`);
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) {
    throw new RentalBookingHistoryUnavailableError(`${label} exceeded the supported database count range.`);
  }
  return count;
}

type RentalBookingReadTransaction = Pick<Prisma.TransactionClient, '$queryRaw'>;

async function readOverdueRentalBookingCount(
  transaction: RentalBookingReadTransaction,
  input: Readonly<{ organizationId: string; observedAt: Date }>,
) {
  const rows = await transaction.$queryRaw<Array<{ total: string }>>`
    SELECT COUNT(*)::text AS "total"
      FROM "rental_bookings" booking
      JOIN "rental_locations" location
        ON location."id" = booking."locationId"
       AND location."organizationId" = booking."organizationId"
      JOIN "rental_booking_fulfillment_events" pickup
        ON pickup."bookingId" = booking."id"
       AND pickup."organizationId" = booking."organizationId"
       AND pickup."organizationId" = ${input.organizationId}::uuid
       AND pickup."kind" = 'PICKED_UP'
     WHERE booking."organizationId" = ${input.organizationId}::uuid
       AND location."organizationId" = ${input.organizationId}::uuid
       AND booking."status" = 'CONFIRMED'
       AND (${input.observedAt}::timestamptz AT TIME ZONE location."timeZone")::date >= pickup."endsOn"
       AND NOT EXISTS (
            SELECT 1
              FROM "rental_booking_fulfillment_events" returned
             WHERE returned."organizationId" = ${input.organizationId}::uuid
               AND returned."bookingId" = booking."id"
               AND returned."kind" = 'RETURNED'
       )
  `;

  return requireDatabaseCount(rows[0]?.total, 'Overdue rental custody');
}

async function readOverdueRentalBookingPageIds(
  transaction: RentalBookingReadTransaction,
  input: Readonly<{
    organizationId: string;
    observedAt: Date;
    offset: number;
    limit: number;
  }>,
) {
  if (!Number.isSafeInteger(input.offset) || input.offset < 0) {
    throw new RentalBookingHistoryUnavailableError('Overdue rental custody pagination offset is invalid.');
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new RentalBookingHistoryUnavailableError('Overdue rental custody pagination limit is invalid.');
  }

  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT booking."id"
      FROM "rental_bookings" booking
      JOIN "rental_locations" location
        ON location."id" = booking."locationId"
       AND location."organizationId" = booking."organizationId"
      JOIN "rental_booking_fulfillment_events" pickup
        ON pickup."bookingId" = booking."id"
       AND pickup."organizationId" = booking."organizationId"
       AND pickup."organizationId" = ${input.organizationId}::uuid
       AND pickup."kind" = 'PICKED_UP'
     WHERE booking."organizationId" = ${input.organizationId}::uuid
       AND location."organizationId" = ${input.organizationId}::uuid
       AND booking."status" = 'CONFIRMED'
       AND (${input.observedAt}::timestamptz AT TIME ZONE location."timeZone")::date >= pickup."endsOn"
       AND NOT EXISTS (
            SELECT 1
              FROM "rental_booking_fulfillment_events" returned
             WHERE returned."organizationId" = ${input.organizationId}::uuid
               AND returned."bookingId" = booking."id"
               AND returned."kind" = 'RETURNED'
       )
     ORDER BY booking."createdAt" DESC, booking."id" DESC
     OFFSET ${input.offset}
     LIMIT ${input.limit}
  `;

  return Object.freeze(rows.map((row) => row.id));
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
    select: { kind: true, occurredAt: true, endsOn: true },
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
    const [booking, databaseClock] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: { id: input.bookingId, organizationId: input.organizationId },
        include: rentalBookingDetailInclude,
      }),
      transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`,
    ]);
    if (!booking) throw new RentalBookingUnavailableError();
    const observedAt = requireDatabaseObservation(databaseClock);

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
    const fulfillment = deriveRentalBookingFulfillmentState(fulfillmentEvents);
    const custody = deriveRentalBookingCustodyReadState({
      bookingStatus: booking.status,
      fulfillmentState: fulfillment.state,
      fulfillmentEvents,
      observedAt,
      timeZone: booking.location.timeZone,
    });

    return Object.freeze({
      ...booking,
      reschedules: Object.freeze(reschedules),
      unitSubstitutions: Object.freeze(unitSubstitutions),
      fulfillmentEvents: Object.freeze(fulfillmentEvents),
      fulfillment,
      custody,
    });
  }, { isolationLevel: 'RepeatableRead' });
}

export async function listRentalBookings(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  status?: RentalBookingListStatus;
  custody?: RentalBookingListCustody;
  page?: number;
  pageSize?: number;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' });

  const pagination = normalizePagination(input.page ?? 1, input.pageSize ?? 25);
  const status = input.status ?? 'ALL';
  const custody = input.custody ?? 'ALL';
  const where: Prisma.RentalBookingWhereInput = { organizationId: input.organizationId };
  if (status !== 'ALL') where.status = status;

  return db.$transaction(async (transaction) => {
    const databaseClock = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
    const observedAt = requireDatabaseObservation(databaseClock);
    const overdueCount = await readOverdueRentalBookingCount(transaction, {
      organizationId: input.organizationId,
      observedAt,
    });

    let total: number;
    let page: number;
    let bookingRows: Prisma.RentalBookingGetPayload<{ include: typeof rentalBookingListInclude }>[];

    if (custody === 'OVERDUE') {
      total = status === 'CANCELLED' ? 0 : overdueCount;
      const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
      page = Math.min(pagination.page, totalPages);
      const bookingIds = total === 0
        ? Object.freeze([] as string[])
        : await readOverdueRentalBookingPageIds(transaction, {
          organizationId: input.organizationId,
          observedAt,
          offset: (page - 1) * pagination.pageSize,
          limit: pagination.pageSize,
        });
      bookingRows = await transaction.rentalBooking.findMany({
        where: { organizationId: input.organizationId, id: { in: bookingIds } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: rentalBookingListInclude,
      });
      if (bookingRows.length !== bookingIds.length) {
        throw new RentalBookingHistoryUnavailableError(
          'Overdue rental custody queue could not re-read every tenant-scoped booking in its snapshot.',
        );
      }
    } else {
      total = await transaction.rentalBooking.count({ where });
      const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
      page = Math.min(pagination.page, totalPages);
      bookingRows = await transaction.rentalBooking.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pagination.pageSize,
        take: pagination.pageSize,
        include: rentalBookingListInclude,
      });
    }

    const bookings = bookingRows.map((booking) => {
      const fulfillment = deriveRentalBookingFulfillmentState(booking.fulfillmentEvents);
      return Object.freeze({
        ...booking,
        fulfillment,
        custody: deriveRentalBookingCustodyReadState({
          bookingStatus: booking.status,
          fulfillmentState: fulfillment.state,
          fulfillmentEvents: booking.fulfillmentEvents,
          observedAt,
          timeZone: booking.location.timeZone,
        }),
      });
    });
    if (custody === 'OVERDUE' && bookings.some((booking) => !booking.custody.overdue)) {
      throw new RentalBookingHistoryUnavailableError(
        'Overdue rental custody queue disagreed with retained booking custody evidence.',
      );
    }
    const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));

    return Object.freeze({
      bookings: Object.freeze(bookings),
      total,
      overdueCount,
      page,
      pageSize: pagination.pageSize,
      totalPages,
    });
  }, { isolationLevel: 'RepeatableRead' });
}
