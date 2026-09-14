export class RentalInventoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalInventoryValidationError';
  }
}

export type RentalUnitTypeInput = {
  name: string;
  code: string;
  description?: string;
  currency: string;
  defaultDailyRateMinor: string | number;
};

export type RentalUnitInput = {
  unitTypeId: string;
  name: string;
  code: string;
  description?: string;
};

export type RentalDateRangeInput = {
  startsOn: string;
  endsOn: string;
};

export type RentalAvailabilityBlockInput = RentalDateRangeInput & {
  unitId: string;
  reason?: string;
};

export type RentalRatePeriodInput = RentalDateRangeInput & {
  unitTypeId: string;
  dailyRateMinor: string | number;
};

function normalizeText(value: string | undefined, field: string, maxLength: number, required = true) {
  const normalized = value?.trim() ?? '';
  if (required && !normalized) throw new RentalInventoryValidationError(`${field} is required.`);
  if (normalized.length > maxLength) throw new RentalInventoryValidationError(`${field} is too long.`);
  return normalized || null;
}

export function normalizeRentalCode(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(normalized)) {
    throw new RentalInventoryValidationError('Code must use 1-32 letters, numbers, dashes, or underscores.');
  }
  return normalized;
}

export function normalizeRentalCurrency(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new RentalInventoryValidationError('Currency must be a three-letter ISO-style code.');
  }
  return normalized;
}

export function normalizeRentalMoneyMinor(value: string | number, field = 'Daily rate') {
  const normalized = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isSafeInteger(normalized) || normalized <= 0 || normalized > 100_000_000) {
    throw new RentalInventoryValidationError(`${field} must be a positive minor-unit amount.`);
  }
  return normalized;
}

export function normalizeRentalDate(value: string, field: string) {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new RentalInventoryValidationError(`${field} must use YYYY-MM-DD.`);
  }
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RentalInventoryValidationError(`${field} is not a valid calendar date.`);
  }
  return date;
}

export function normalizeRentalDateRange(input: RentalDateRangeInput) {
  const startsOn = normalizeRentalDate(input.startsOn, 'Start date');
  const endsOn = normalizeRentalDate(input.endsOn, 'End date');
  if (startsOn >= endsOn) {
    throw new RentalInventoryValidationError('End date must be after start date.');
  }
  const days = (endsOn.getTime() - startsOn.getTime()) / 86_400_000;
  if (days > 731) {
    throw new RentalInventoryValidationError('Rental inventory date ranges cannot exceed 731 days.');
  }
  return { startsOn, endsOn };
}

export function normalizeRentalUnitTypeInput(input: RentalUnitTypeInput) {
  return {
    name: normalizeText(input.name, 'Unit type name', 160) as string,
    code: normalizeRentalCode(input.code),
    description: normalizeText(input.description, 'Description', 1000, false),
    currency: normalizeRentalCurrency(input.currency),
    defaultDailyRateMinor: normalizeRentalMoneyMinor(input.defaultDailyRateMinor, 'Default daily rate'),
  };
}

export function normalizeRentalUnitInput(input: RentalUnitInput) {
  return {
    unitTypeId: input.unitTypeId.trim(),
    name: normalizeText(input.name, 'Unit name', 160) as string,
    code: normalizeRentalCode(input.code),
    description: normalizeText(input.description, 'Description', 1000, false),
  };
}

export function normalizeRentalAvailabilityBlockInput(input: RentalAvailabilityBlockInput) {
  return {
    unitId: input.unitId.trim(),
    ...normalizeRentalDateRange(input),
    reason: normalizeText(input.reason, 'Reason', 500, false),
  };
}

export function normalizeRentalRatePeriodInput(input: RentalRatePeriodInput) {
  return {
    unitTypeId: input.unitTypeId.trim(),
    ...normalizeRentalDateRange(input),
    dailyRateMinor: normalizeRentalMoneyMinor(input.dailyRateMinor),
  };
}

export function assertRentalArchiveConfirmation(value: string) {
  if (value.trim().toUpperCase() !== 'ARCHIVE') {
    throw new RentalInventoryValidationError('Type ARCHIVE to confirm this change.');
  }
}

export function assertRentalRemoveConfirmation(value: string) {
  if (value.trim().toUpperCase() !== 'REMOVE') {
    throw new RentalInventoryValidationError('Type REMOVE to confirm this change.');
  }
}
