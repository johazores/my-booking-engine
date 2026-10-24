import {
  normalizeRentalDateRange,
  RentalInventoryValidationError,
} from './rental-domain.ts';

const HOLD_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;

export const DEFAULT_RENTAL_HOLD_MINUTES = 15;
export const MAX_RENTAL_HOLD_MINUTES = 30;

export type RentalAvailabilityHoldInput = Readonly<{
  unitId: string;
  startsOn: string;
  endsOn: string;
  idempotencyKey: string;
  expiresInMinutes?: string | number;
}>;

export function normalizeRentalAvailabilityHoldInput(input: RentalAvailabilityHoldInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || typeof input.unitId !== 'string'
    || typeof input.startsOn !== 'string'
    || typeof input.endsOn !== 'string'
    || typeof input.idempotencyKey !== 'string') {
    throw new RentalInventoryValidationError('Rental hold fields are invalid.');
  }
  const idempotencyKey = input.idempotencyKey.trim();
  if (!HOLD_KEY_PATTERN.test(idempotencyKey)) {
    throw new RentalInventoryValidationError(
      'Idempotency key must be 8-120 letters, numbers, dots, underscores, colons, or hyphens.',
    );
  }

  // Only an omitted duration receives the default; explicit null is invalid.
  const rawMinutes = input.expiresInMinutes === undefined ? DEFAULT_RENTAL_HOLD_MINUTES : input.expiresInMinutes;
  if (typeof rawMinutes === 'string' && !/^[0-9]{1,16}$/.test(rawMinutes.trim())) {
    throw new RentalInventoryValidationError(
      `Hold duration must be between 1 and ${MAX_RENTAL_HOLD_MINUTES} minutes.`,
    );
  }
  const expiresInMinutes = typeof rawMinutes === 'number'
    ? rawMinutes
    : typeof rawMinutes === 'string' ? Number(rawMinutes.trim()) : Number.NaN;
  if (
    !Number.isSafeInteger(expiresInMinutes)
    || expiresInMinutes < 1
    || expiresInMinutes > MAX_RENTAL_HOLD_MINUTES
  ) {
    throw new RentalInventoryValidationError(
      `Hold duration must be between 1 and ${MAX_RENTAL_HOLD_MINUTES} minutes.`,
    );
  }

  const dateRange = normalizeRentalDateRange(input);
  const rentalDays = (dateRange.endsOn.getTime() - dateRange.startsOn.getTime()) / 86_400_000;
  if (rentalDays > 90) {
    throw new RentalInventoryValidationError('Rental availability holds cannot exceed 90 days.');
  }

  return Object.freeze({
    unitId: input.unitId.trim(),
    ...dateRange,
    idempotencyKey,
    expiresInMinutes,
  });
}

export function rentalAvailabilityHoldPayloadMatches(input: Readonly<{
  hold: {
    unitId: string;
    startsOn: Date;
    endsOn: Date;
    createdAt: Date;
    expiresAt: Date;
  };
  requested: {
    unitId: string;
    startsOn: Date;
    endsOn: Date;
    expiresInMinutes: number;
  };
}>) {
  const requestedDurationMilliseconds = input.requested.expiresInMinutes * 60_000;
  return input.hold.unitId === input.requested.unitId
    && input.hold.startsOn.getTime() === input.requested.startsOn.getTime()
    && input.hold.endsOn.getTime() === input.requested.endsOn.getTime()
    && input.hold.expiresAt.getTime() - input.hold.createdAt.getTime() === requestedDurationMilliseconds;
}
