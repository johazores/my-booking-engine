export type AppointmentServiceInput = Readonly<{
  name: string;
  code: string;
  description: string;
  durationMinutes: string;
  bufferBeforeMinutes: string;
  bufferAfterMinutes: string;
}>;

export type AppointmentStaffInput = Readonly<{
  name: string;
  code: string;
  description: string;
  timezone: string;
}>;

export type AppointmentScheduleInput = Readonly<{
  dayOfWeek: string;
  startsAt: string;
  endsAt: string;
}>;

export class AppointmentInventoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppointmentInventoryValidationError';
  }
}

function requiredText(value: string, label: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength) {
    throw new AppointmentInventoryValidationError(`${label} must be between 1 and ${maxLength} characters.`);
  }
  return normalized;
}

function optionalText(value: string, label: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new AppointmentInventoryValidationError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function inventoryCode(value: string, label: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(normalized)) {
    throw new AppointmentInventoryValidationError(`${label} must use 1-32 letters, numbers, underscores, or hyphens.`);
  }
  return normalized;
}

function wholeNumber(value: string, label: string, minimum: number, maximum: number) {
  if (!/^\d+$/.test(value.trim())) {
    throw new AppointmentInventoryValidationError(`${label} must be a whole number.`);
  }
  const normalized = Number(value.trim());
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new AppointmentInventoryValidationError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return normalized;
}

function timezone(value: string) {
  const normalized = requiredText(value, 'Timezone', 80);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format();
  } catch {
    throw new AppointmentInventoryValidationError('Timezone must be a valid IANA timezone.');
  }
  return normalized;
}

function clockMinute(value: string, label: string, allowEndOfDay = false) {
  const normalized = value.trim();
  if (allowEndOfDay && normalized === '24:00') return 1440;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(normalized);
  if (!match) {
    throw new AppointmentInventoryValidationError(`${label} must use 24-hour HH:MM format.`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function normalizeAppointmentServiceInput(input: AppointmentServiceInput) {
  const durationMinutes = wholeNumber(input.durationMinutes, 'Service duration', 5, 1440);
  const bufferBeforeMinutes = wholeNumber(input.bufferBeforeMinutes || '0', 'Buffer before', 0, 480);
  const bufferAfterMinutes = wholeNumber(input.bufferAfterMinutes || '0', 'Buffer after', 0, 480);
  if (durationMinutes + bufferBeforeMinutes + bufferAfterMinutes > 1440) {
    throw new AppointmentInventoryValidationError('Service duration and buffers cannot exceed 24 hours.');
  }
  return {
    name: requiredText(input.name, 'Service name', 160),
    code: inventoryCode(input.code, 'Service code'),
    description: optionalText(input.description, 'Description', 1000),
    durationMinutes,
    bufferBeforeMinutes,
    bufferAfterMinutes,
  };
}

export function normalizeAppointmentStaffInput(input: AppointmentStaffInput) {
  return {
    name: requiredText(input.name, 'Staff name', 160),
    code: inventoryCode(input.code, 'Staff code'),
    description: optionalText(input.description, 'Description', 1000),
    timezone: timezone(input.timezone),
  };
}

export function normalizeAppointmentScheduleInput(input: AppointmentScheduleInput) {
  const dayOfWeek = wholeNumber(input.dayOfWeek, 'Day of week', 0, 6);
  const startsAtMinute = clockMinute(input.startsAt, 'Schedule start');
  const endsAtMinute = clockMinute(input.endsAt, 'Schedule end', true);
  if (endsAtMinute <= startsAtMinute) {
    throw new AppointmentInventoryValidationError('Schedule end must be after schedule start on the same day.');
  }
  return { dayOfWeek, startsAtMinute, endsAtMinute };
}

export function normalizeAppointmentServiceCode(value: string) {
  return inventoryCode(value, 'Service code');
}

export function assertAppointmentArchiveConfirmation(value: string) {
  if (value.trim().toUpperCase() !== 'ARCHIVE') {
    throw new AppointmentInventoryValidationError('Type ARCHIVE to confirm archival.');
  }
}

export function assertAppointmentRemoveConfirmation(value: string) {
  if (value.trim().toUpperCase() !== 'REMOVE') {
    throw new AppointmentInventoryValidationError('Type REMOVE to confirm assignment removal.');
  }
}
