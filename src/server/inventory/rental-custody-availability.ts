import type { Prisma } from '../../generated/prisma/client.ts';
import { RentalAvailabilityIntegrityError } from './rental-availability-domain.ts';

const MAX_OPEN_CUSTODY_ROWS = 1_000;

type RentalCustodyTransaction = Pick<Prisma.TransactionClient, 'rentalBookingFulfillmentEvent'>;

function dateKey(date: Date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RentalAvailabilityIntegrityError('Rental custody evidence contains an invalid date.');
  }
  return date.toISOString().slice(0, 10);
}

export function rentalLocalDateKey(now: Date, timeZone: string) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new RentalAvailabilityIntegrityError('Rental custody time authority is invalid.');
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (!values.year || !values.month || !values.day) throw new Error('Incomplete local date.');
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    throw new RentalAvailabilityIntegrityError('Rental custody location timezone is invalid.');
  }
}

export function rentalCustodyIsOverdue(input: Readonly<{
  observedAt: Date;
  endsOn: Date;
  timeZone: string;
}>) {
  return rentalLocalDateKey(input.observedAt, input.timeZone) >= dateKey(input.endsOn);
}

export async function findOverdueRentalCustodyUnitIds(
  transaction: RentalCustodyTransaction,
  input: Readonly<{
    organizationId: string;
    observedAt: Date;
    unitId?: string;
    unitTypeId?: string;
    locationId?: string;
    excludeBookingId?: string;
  }>,
) {
  const events = await transaction.rentalBookingFulfillmentEvent.findMany({
    where: {
      organizationId: input.organizationId,
      kind: 'PICKED_UP',
      ...(input.unitId ? { unitId: input.unitId } : {}),
      booking: {
        is: {
          organizationId: input.organizationId,
          status: 'CONFIRMED',
          ...(input.excludeBookingId ? { id: { not: input.excludeBookingId } } : {}),
          ...(input.unitTypeId ? { unitTypeId: input.unitTypeId } : {}),
          ...(input.locationId ? { locationId: input.locationId } : {}),
          fulfillmentEvents: {
            none: {
              organizationId: input.organizationId,
              kind: 'RETURNED',
            },
          },
        },
      },
    },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    take: MAX_OPEN_CUSTODY_ROWS + 1,
    select: {
      bookingId: true,
      unitId: true,
      endsOn: true,
      booking: {
        select: {
          location: { select: { timeZone: true } },
        },
      },
    },
  });

  if (events.length > MAX_OPEN_CUSTODY_ROWS) {
    throw new RentalAvailabilityIntegrityError(
      'Rental custody reconciliation exceeded the supported safety limit.',
    );
  }

  const overdue = new Set<string>();
  for (const event of events) {
    if (rentalCustodyIsOverdue({
      observedAt: input.observedAt,
      endsOn: event.endsOn,
      timeZone: event.booking.location.timeZone,
    })) {
      overdue.add(event.unitId);
    }
  }
  return Object.freeze([...overdue]);
}
