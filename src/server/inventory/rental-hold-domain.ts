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
  const idempotencyKey = input.idempotencyKey.trim();
  if (!HOLD_KEY_PATTERN.test(idempotencyKey)) {
    throw new RentalInventoryValidationError(
      'Idempotency key must be 8-120 letters, numbers, dots, underscores, colons, or hyphens.',
    );
  }

  const rawMinutes = input.expiresInMinutes ?? DEFAULT_RENTAL_HOLD_MINUTES;
  if (typeof rawMinutes === 'string' && !/^\d+$/.test(rawMinutes.trim())) {
    throw new RentalInventoryValidationError(
      `Hold duration must be between 1 and ${MAX_RENTAL_HOLD_MINUTES} minutes.`,
    );
  }
  const expiresInMinutes = typeof rawMinutes === 'number'
    ? rawMinutes
    : Number(rawMinutes.trim());
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
  };
  requested: {
    unitId: string;
    startsOn: Date;
    endsOn: Date;
  };
}>) {
  return input.hold.unitId === input.requested.unitId
    && input.hold.startsOn.getTime() === input.requested.startsOn.getTime()
    && input.hold.endsOn.getTime() === input.requested.endsOn.getTime();
}
