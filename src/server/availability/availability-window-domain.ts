import { parseAvailabilityDate, AvailabilityValidationError } from './availability-domain.ts';

export type AvailabilityWindowInput = {
  propertyId: string;
  roomTypeId: string;
  startDate: string;
  endDate: string;
  capacityLimit: string | number;
};

export function normalizeAvailabilityWindowInput(input: AvailabilityWindowInput) {
  const startDate = parseAvailabilityDate(input.startDate, 'Start date');
  const endDate = parseAvailabilityDate(input.endDate, 'End date');
  if (endDate < startDate) throw new AvailabilityValidationError('End date must be on or after start date.');
  const capacityLimit = typeof input.capacityLimit === 'number' ? input.capacityLimit : Number.parseInt(input.capacityLimit, 10);
  if (!Number.isSafeInteger(capacityLimit) || capacityLimit < 0 || capacityLimit > 50) {
    throw new AvailabilityValidationError('Capacity limit must be between 0 and 50.');
  }
  return {
    propertyId: input.propertyId.trim(),
    roomTypeId: input.roomTypeId.trim(),
    startDate,
    endDate,
    capacityLimit,
  };
}

export function effectiveWindowCapacity(input: {
  physicalCapacity: number;
  arrivalDate: Date;
  departureDate: Date;
  windows: readonly { startDate: Date; endDate: Date; capacityLimit: number }[];
}) {
  let sellable = input.physicalCapacity;
  for (const window of input.windows) {
    if (window.startDate < input.departureDate && window.endDate >= input.arrivalDate) {
      sellable = Math.min(sellable, window.capacityLimit);
    }
  }
  return Math.max(0, sellable);
}
