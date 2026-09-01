import { parseAvailabilityDate } from '../availability/availability-domain.ts';

export type HospitalityBookingRescheduleInput = {
  arrivalDate: string;
  departureDate: string;
  idempotencyKey: string;
};

export type HospitalityBookingPriceSnapshot = {
  currency: string;
  accommodationSubtotalMinor: bigint | string;
  taxTotalMinor: bigint | string;
  feeTotalMinor: bigint | string;
  addonTotalMinor: bigint | string;
  totalMinor: bigint | string;
};

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;

export class HospitalityBookingRescheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityBookingRescheduleValidationError';
  }
}

export function normalizeHospitalityBookingRescheduleInput(input: HospitalityBookingRescheduleInput) {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new HospitalityBookingRescheduleValidationError('Idempotency key must be 8-120 letters, numbers, dots, underscores, colons, or hyphens.');
  }

  const arrivalDate = parseAvailabilityDate(input.arrivalDate, 'Arrival date');
  const departureDate = parseAvailabilityDate(input.departureDate, 'Departure date');
  if (departureDate <= arrivalDate) {
    throw new HospitalityBookingRescheduleValidationError('Departure date must be after arrival date.');
  }
  const stayNights = Math.round((departureDate.getTime() - arrivalDate.getTime()) / 86_400_000);
  if (stayNights > 365) throw new HospitalityBookingRescheduleValidationError('Stay length cannot exceed 365 nights.');

  return { arrivalDate, departureDate, stayNights, idempotencyKey };
}

export function hospitalityBookingPriceSnapshotMatches(
  current: HospitalityBookingPriceSnapshot,
  candidate: HospitalityBookingPriceSnapshot,
) {
  return current.currency === candidate.currency
    && BigInt(current.accommodationSubtotalMinor) === BigInt(candidate.accommodationSubtotalMinor)
    && BigInt(current.taxTotalMinor) === BigInt(candidate.taxTotalMinor)
    && BigInt(current.feeTotalMinor) === BigInt(candidate.feeTotalMinor)
    && BigInt(current.addonTotalMinor) === BigInt(candidate.addonTotalMinor)
    && BigInt(current.totalMinor) === BigInt(candidate.totalMinor);
}
