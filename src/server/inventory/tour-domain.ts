export type TourProductKind = 'TOUR' | 'PACKAGE';

export type TourProductInput = Readonly<{
  kind: string;
  name: string;
  code: string;
  description: string;
  timezone: string;
  meetingPoint: string;
}>;

export type TourDepartureInput = Readonly<{
  startsAt: string;
  endsAt: string;
  capacity: string;
}>;

export type TourAddonInput = Readonly<{
  name: string;
  code: string;
  description: string;
  maxQuantityPerBooking: string;
}>;

export class TourInventoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TourInventoryValidationError';
  }
}

function requiredText(value: string, label: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength) {
    throw new TourInventoryValidationError(`${label} must be between 1 and ${maxLength} characters.`);
  }
  return normalized;
}

function optionalText(value: string, label: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new TourInventoryValidationError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function inventoryCode(value: string, label: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(normalized)) {
    throw new TourInventoryValidationError(`${label} must use 1-32 letters, numbers, underscores, or hyphens.`);
  }
  return normalized;
}

function timezone(value: string) {
  const normalized = requiredText(value, 'Timezone', 80);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format();
  } catch {
    throw new TourInventoryValidationError('Timezone must be a valid IANA timezone.');
  }
  return normalized;
}

function positiveInteger(value: string, label: string, maximum: number) {
  if (!/^\d+$/.test(value.trim())) {
    throw new TourInventoryValidationError(`${label} must be a whole number.`);
  }
  const normalized = Number(value.trim());
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new TourInventoryValidationError(`${label} must be between 1 and ${maximum}.`);
  }
  return normalized;
}

function exactInstant(value: string, label: string) {
  const normalized = value.trim();
  if (normalized.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) {
    throw new TourInventoryValidationError(`${label} must be an RFC 3339 timestamp with an explicit UTC offset.`);
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new TourInventoryValidationError(`${label} must be a valid timestamp.`);
  }
  return date;
}

export function normalizeTourProductInput(input: TourProductInput) {
  const kind = input.kind.trim().toUpperCase();
  if (kind !== 'TOUR' && kind !== 'PACKAGE') {
    throw new TourInventoryValidationError('Product kind must be TOUR or PACKAGE.');
  }
  return {
    kind: kind as TourProductKind,
    name: requiredText(input.name, 'Tour or package name', 160),
    code: inventoryCode(input.code, 'Tour or package code'),
    description: optionalText(input.description, 'Description', 1000),
    timezone: timezone(input.timezone),
    meetingPoint: optionalText(input.meetingPoint, 'Meeting point', 300),
  };
}

export function normalizeTourDepartureInput(input: TourDepartureInput) {
  const startsAt = exactInstant(input.startsAt, 'Departure start');
  const endsAt = exactInstant(input.endsAt, 'Departure end');
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new TourInventoryValidationError('Departure end must be after departure start.');
  }
  const maximumDurationMs = 31 * 24 * 60 * 60 * 1000;
  if (endsAt.getTime() - startsAt.getTime() > maximumDurationMs) {
    throw new TourInventoryValidationError('A tour departure cannot span more than 31 days.');
  }
  return {
    startsAt,
    endsAt,
    capacity: positiveInteger(input.capacity, 'Departure capacity', 10_000),
  };
}

export function normalizeTourAddonInput(input: TourAddonInput) {
  return {
    name: requiredText(input.name, 'Add-on name', 120),
    code: inventoryCode(input.code, 'Add-on code'),
    description: optionalText(input.description, 'Add-on description', 500),
    maxQuantityPerBooking: positiveInteger(input.maxQuantityPerBooking, 'Maximum add-on quantity per booking', 100),
  };
}

export function assertTourArchiveConfirmation(value: string) {
  if (value.trim().toUpperCase() !== 'ARCHIVE') {
    throw new TourInventoryValidationError('Type ARCHIVE to confirm archival.');
  }
}
