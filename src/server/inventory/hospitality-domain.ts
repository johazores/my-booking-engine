export type InventoryLifecycleStatus = 'ACTIVE' | 'ARCHIVED';
export type RoomOperationalStatus = 'ACTIVE' | 'OUT_OF_SERVICE' | 'ARCHIVED';

export type PropertyInput = {
  name: string;
  code: string;
  timezone: string;
  addressLine1: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
};

export type RoomTypeInput = {
  propertyId: string;
  name: string;
  code: string;
  maxOccupancy: string;
  bedsDescription: string;
};

export type RoomInput = {
  propertyId: string;
  roomTypeId: string;
  code: string;
  floor: string;
};

export type AmenityInput = {
  name: string;
  code: string;
};

export class HospitalityInventoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityInventoryValidationError';
  }
}

function requiredText(value: string, label: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength) {
    throw new HospitalityInventoryValidationError(`${label} must be between 1 and ${maxLength} characters.`);
  }
  return normalized;
}

function optionalText(value: string, label: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new HospitalityInventoryValidationError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function inventoryCode(value: string, label: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(normalized)) {
    throw new HospitalityInventoryValidationError(`${label} must use 1-32 letters, numbers, underscores, or hyphens.`);
  }
  return normalized;
}

function timezone(value: string) {
  const normalized = requiredText(value, 'Timezone', 80);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format();
  } catch {
    throw new HospitalityInventoryValidationError('Timezone must be a valid IANA timezone.');
  }
  return normalized;
}

function countryCode(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new HospitalityInventoryValidationError('Country code must be a two-letter ISO code.');
  }
  return normalized;
}

export function normalizePropertyInput(input: PropertyInput) {
  return {
    name: requiredText(input.name, 'Property name', 160),
    code: inventoryCode(input.code, 'Property code'),
    timezone: timezone(input.timezone),
    addressLine1: optionalText(input.addressLine1, 'Address', 200),
    city: optionalText(input.city, 'City', 120),
    region: optionalText(input.region, 'Region', 120),
    postalCode: optionalText(input.postalCode, 'Postal code', 24),
    countryCode: countryCode(input.countryCode),
  };
}

export function normalizeRoomTypeInput(input: RoomTypeInput) {
  const maxOccupancy = Number.parseInt(input.maxOccupancy, 10);
  if (!Number.isSafeInteger(maxOccupancy) || maxOccupancy < 1 || maxOccupancy > 50) {
    throw new HospitalityInventoryValidationError('Maximum occupancy must be between 1 and 50.');
  }
  return {
    propertyId: input.propertyId.trim(),
    name: requiredText(input.name, 'Room type name', 120),
    code: inventoryCode(input.code, 'Room type code'),
    maxOccupancy,
    bedsDescription: optionalText(input.bedsDescription, 'Bed description', 160),
  };
}

export function normalizeRoomInput(input: RoomInput) {
  return {
    propertyId: input.propertyId.trim(),
    roomTypeId: input.roomTypeId.trim(),
    code: inventoryCode(input.code, 'Room code'),
    floor: optionalText(input.floor, 'Floor', 40),
  };
}

export function normalizeAmenityInput(input: AmenityInput) {
  return {
    name: requiredText(input.name, 'Amenity name', 120),
    code: inventoryCode(input.code, 'Amenity code'),
  };
}

export function assertInventoryArchiveConfirmation(value: string) {
  if (value.trim().toUpperCase() !== 'ARCHIVE') {
    throw new HospitalityInventoryValidationError('Type ARCHIVE to confirm archival.');
  }
}

export const INVENTORY_PAGE_SIZE_DEFAULT = 20;
export const INVENTORY_PAGE_SIZE_MAX = 50;

export function parseInventoryPage(value: string | undefined) {
  const page = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function parseInventoryPageSize(value: string | undefined) {
  const size = Number.parseInt(value ?? '', 10);
  if (!Number.isSafeInteger(size) || size < 1) return INVENTORY_PAGE_SIZE_DEFAULT;
  return Math.min(size, INVENTORY_PAGE_SIZE_MAX);
}
