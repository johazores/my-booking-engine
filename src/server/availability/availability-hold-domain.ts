import { normalizeAvailabilityRequest, type AvailabilityRequestInput } from './availability-domain.ts';

export type AvailabilityHoldInput = {
  idempotencyKey: string;
  expiresInMinutes?: string | number;
  request: AvailabilityRequestInput;
};

export type AvailabilityCapacityRecord = {
  arrivalDate: Date;
  departureDate: Date;
  quantity: number;
};

export type AvailabilityWindowCapacityRecord = {
  startDate: Date;
  endDate: Date;
  capacityLimit: number;
};

export class AvailabilityHoldValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvailabilityHoldValidationError';
  }
}

const HOLD_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;
const DAY_MS = 86_400_000;
export const DEFAULT_HOLD_MINUTES = 15;
export const MAX_HOLD_MINUTES = 30;

export function normalizeAvailabilityHoldInput(input: AvailabilityHoldInput) {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!HOLD_KEY_PATTERN.test(idempotencyKey)) {
    throw new AvailabilityHoldValidationError('Idempotency key must be 8-120 letters, numbers, dots, underscores, colons, or hyphens.');
  }
  const rawMinutes = input.expiresInMinutes ?? DEFAULT_HOLD_MINUTES;
  if (typeof rawMinutes === 'string' && !/^\d+$/.test(rawMinutes.trim())) {
    throw new AvailabilityHoldValidationError(`Hold duration must be between 1 and ${MAX_HOLD_MINUTES} minutes.`);
  }
  const expiresInMinutes = typeof rawMinutes === 'number' ? rawMinutes : Number(rawMinutes.trim());
  if (!Number.isSafeInteger(expiresInMinutes) || expiresInMinutes < 1 || expiresInMinutes > MAX_HOLD_MINUTES) {
    throw new AvailabilityHoldValidationError(`Hold duration must be between 1 and ${MAX_HOLD_MINUTES} minutes.`);
  }
  return { idempotencyKey, expiresInMinutes, request: normalizeAvailabilityRequest(input.request) };
}

export function calculateAvailabilityHoldCapacity(input: {
  physicalCapacity: number;
  arrivalDate: Date;
  departureDate: Date;
  windows: readonly AvailabilityWindowCapacityRecord[];
  holds: readonly AvailabilityCapacityRecord[];
  allocations?: readonly AvailabilityCapacityRecord[];
}) {
  let sellableUnits = input.physicalCapacity;
  let peakHeldUnits = 0;
  let peakAllocatedUnits = 0;
  let peakProtectedUnits = 0;
  let constrainedNightCount = 0;
  const allocations = input.allocations ?? [];

  for (let time = input.arrivalDate.getTime(); time < input.departureDate.getTime(); time += DAY_MS) {
    const night = new Date(time);
    let nightCapacity = input.physicalCapacity;
    for (const window of input.windows) {
      if (window.startDate <= night && window.endDate >= night) nightCapacity = Math.min(nightCapacity, window.capacityLimit);
    }
    let heldUnits = 0;
    for (const hold of input.holds) {
      if (hold.arrivalDate <= night && hold.departureDate > night) heldUnits += hold.quantity;
    }
    let allocatedUnits = 0;
    for (const allocation of allocations) {
      if (allocation.arrivalDate <= night && allocation.departureDate > night) allocatedUnits += allocation.quantity;
    }
    const protectedUnits = heldUnits + allocatedUnits;
    peakHeldUnits = Math.max(peakHeldUnits, heldUnits);
    peakAllocatedUnits = Math.max(peakAllocatedUnits, allocatedUnits);
    peakProtectedUnits = Math.max(peakProtectedUnits, protectedUnits);
    const remaining = Math.max(0, nightCapacity - protectedUnits);
    if (remaining < input.physicalCapacity) constrainedNightCount += 1;
    sellableUnits = Math.min(sellableUnits, remaining);
  }

  return { sellableUnits, peakHeldUnits, peakAllocatedUnits, peakProtectedUnits, constrainedNightCount };
}

export function availabilityHoldPayloadMatches(input: {
  hold: { propertyId: string; roomTypeId: string; ratePlanId: string; arrivalDate: Date; departureDate: Date; quantity: number };
  request: ReturnType<typeof normalizeAvailabilityRequest>;
}) {
  return input.hold.propertyId === input.request.propertyId
    && input.hold.roomTypeId === input.request.roomTypeId
    && input.hold.ratePlanId === input.request.ratePlanId
    && input.hold.arrivalDate.getTime() === input.request.arrivalDate.getTime()
    && input.hold.departureDate.getTime() === input.request.departureDate.getTime()
    && input.hold.quantity === input.request.quantity;
}
