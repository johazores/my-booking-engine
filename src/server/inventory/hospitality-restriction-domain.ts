import { HospitalityInventoryValidationError } from './hospitality-domain.ts';

export type HospitalityRestrictionInput = {
  propertyId: string;
  ratePlanId: string;
  roomTypeId: string;
  startDate: string;
  endDate: string;
  minStayNights: string;
  maxStayNights: string;
  closedToArrival: string;
  closedToDeparture: string;
};

function normalizedDate(value: string, label: string) {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new HospitalityInventoryValidationError(`${label} must use YYYY-MM-DD.`);
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new HospitalityInventoryValidationError(`${label} must be a real calendar date.`);
  }
  return date;
}

function optionalNights(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) {
    throw new HospitalityInventoryValidationError(`${label} must be a whole number.`);
  }
  const nights = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(nights) || nights < 1 || nights > 365) {
    throw new HospitalityInventoryValidationError(`${label} must be between 1 and 365 nights.`);
  }
  return nights;
}

function formBoolean(value: string) {
  return value === 'true' || value === 'on' || value === '1';
}

export function normalizeHospitalityRestrictionInput(input: HospitalityRestrictionInput) {
  const startDate = normalizedDate(input.startDate, 'Start date');
  const endDate = normalizedDate(input.endDate, 'End date');
  if (endDate < startDate) {
    throw new HospitalityInventoryValidationError('End date must be on or after the start date.');
  }

  const minStayNights = optionalNights(input.minStayNights, 'Minimum stay');
  const maxStayNights = optionalNights(input.maxStayNights, 'Maximum stay');
  if (minStayNights !== null && maxStayNights !== null && minStayNights > maxStayNights) {
    throw new HospitalityInventoryValidationError('Minimum stay cannot exceed maximum stay.');
  }

  const closedToArrival = formBoolean(input.closedToArrival);
  const closedToDeparture = formBoolean(input.closedToDeparture);
  if (minStayNights === null && maxStayNights === null && !closedToArrival && !closedToDeparture) {
    throw new HospitalityInventoryValidationError('Set at least one stay or arrival/departure restriction.');
  }

  return {
    propertyId: input.propertyId.trim(),
    ratePlanId: input.ratePlanId.trim(),
    roomTypeId: input.roomTypeId.trim() || null,
    startDate,
    endDate,
    minStayNights,
    maxStayNights,
    closedToArrival,
    closedToDeparture,
  };
}

export function formatRestrictionDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
