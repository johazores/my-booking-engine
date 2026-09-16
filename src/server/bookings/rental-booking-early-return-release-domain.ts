const MILLISECONDS_PER_DAY = 86_400_000;

export class RentalBookingEarlyReturnReleaseIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingEarlyReturnReleaseIntegrityError';
  }
}

function assertDate(value: Date, field: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RentalBookingEarlyReturnReleaseIntegrityError(`${field} is invalid.`);
  }
}

function localDateKey(value: Date, timeZone: string) {
  assertDate(value, 'Rental return time');
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (!fields.year || !fields.month || !fields.day) throw new Error('Incomplete local date.');
    return `${fields.year}-${fields.month}-${fields.day}`;
  } catch {
    throw new RentalBookingEarlyReturnReleaseIntegrityError(
      'Rental booking location timezone is invalid for early-return inventory release.',
    );
  }
}

function dateOnly(value: Date, field: string) {
  assertDate(value, field);
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export function rentalBookingEarlyReturnReleaseIdempotencyKey(bookingId: string) {
  return `rental-early-return-release:${bookingId}`;
}

export function deriveRentalBookingEarlyReturnReleaseEndsOn(input: Readonly<{
  returnedAt: Date;
  committedStartsOn: Date;
  committedEndsOn: Date;
  timeZone: string;
}>) {
  const committedStartsOn = dateOnly(input.committedStartsOn, 'Committed rental start date');
  const committedEndsOn = dateOnly(input.committedEndsOn, 'Committed rental end date');
  if (committedStartsOn.getTime() >= committedEndsOn.getTime()) {
    throw new RentalBookingEarlyReturnReleaseIntegrityError(
      'Committed rental period is invalid for early-return inventory release.',
    );
  }

  const returnedLocalDate = new Date(`${localDateKey(input.returnedAt, input.timeZone)}T00:00:00.000Z`);
  const dayAfterReturn = new Date(returnedLocalDate.getTime() + MILLISECONDS_PER_DAY);
  const minimumAllocationEnd = new Date(committedStartsOn.getTime() + MILLISECONDS_PER_DAY);
  const releasedEndsOn = new Date(Math.max(dayAfterReturn.getTime(), minimumAllocationEnd.getTime()));

  return releasedEndsOn.getTime() < committedEndsOn.getTime() ? releasedEndsOn : null;
}
