export type AvailabilityRequestInput = {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  arrivalDate: string;
  departureDate: string;
  quantity: string | number;
};

export type AvailabilityRestriction = {
  startDate: Date;
  endDate: Date;
  minStayNights: number | null;
  maxStayNights: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
};

export class AvailabilityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvailabilityValidationError';
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function parseAvailabilityDate(value: string, label: string) {
  const normalized = value.trim();
  if (!DATE_PATTERN.test(normalized)) throw new AvailabilityValidationError(`${label} must use YYYY-MM-DD.`);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new AvailabilityValidationError(`${label} must be a valid calendar date.`);
  }
  return parsed;
}

export function formatAvailabilityDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function normalizeAvailabilityRequest(input: AvailabilityRequestInput) {
  const arrivalDate = parseAvailabilityDate(input.arrivalDate, 'Arrival date');
  const departureDate = parseAvailabilityDate(input.departureDate, 'Departure date');
  if (departureDate <= arrivalDate) throw new AvailabilityValidationError('Departure date must be after arrival date.');
  const stayNights = Math.round((departureDate.getTime() - arrivalDate.getTime()) / DAY_MS);
  if (stayNights > 365) throw new AvailabilityValidationError('Stay length cannot exceed 365 nights.');
  const quantity = typeof input.quantity === 'number' ? input.quantity : Number.parseInt(input.quantity, 10);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) {
    throw new AvailabilityValidationError('Quantity must be between 1 and 50.');
  }
  return {
    propertyId: input.propertyId.trim(),
    roomTypeId: input.roomTypeId.trim(),
    ratePlanId: input.ratePlanId.trim(),
    arrivalDate,
    departureDate,
    stayNights,
    quantity,
  };
}

function dateWithin(value: Date, startDate: Date, endDate: Date) {
  return value >= startDate && value <= endDate;
}

function overlapsOccupiedNights(input: { arrivalDate: Date; departureDate: Date }, restriction: AvailabilityRestriction) {
  return restriction.startDate < input.departureDate && restriction.endDate >= input.arrivalDate;
}

export function evaluateAvailabilityRestrictions(input: {
  arrivalDate: Date;
  departureDate: Date;
  stayNights: number;
  restrictions: readonly AvailabilityRestriction[];
}) {
  let minimumStayNights: number | null = null;
  let maximumStayNights: number | null = null;
  let closedToArrival = false;
  let closedToDeparture = false;

  for (const restriction of input.restrictions) {
    if (overlapsOccupiedNights(input, restriction)) {
      if (restriction.minStayNights !== null) {
        minimumStayNights = Math.max(minimumStayNights ?? restriction.minStayNights, restriction.minStayNights);
      }
      if (restriction.maxStayNights !== null) {
        maximumStayNights = Math.min(maximumStayNights ?? restriction.maxStayNights, restriction.maxStayNights);
      }
    }
    if (restriction.closedToArrival && dateWithin(input.arrivalDate, restriction.startDate, restriction.endDate)) closedToArrival = true;
    if (restriction.closedToDeparture && dateWithin(input.departureDate, restriction.startDate, restriction.endDate)) closedToDeparture = true;
  }

  const reasons: string[] = [];
  if (closedToArrival) reasons.push('closed-to-arrival');
  if (closedToDeparture) reasons.push('closed-to-departure');
  if (minimumStayNights !== null && input.stayNights < minimumStayNights) reasons.push('minimum-stay');
  if (maximumStayNights !== null && input.stayNights > maximumStayNights) reasons.push('maximum-stay');

  return {
    allowed: reasons.length === 0,
    reasons,
    minimumStayNights,
    maximumStayNights,
    closedToArrival,
    closedToDeparture,
  };
}
