import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const MAX_RESERVATION_REFERENCE_LENGTH = 512;
const ASCII_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

function invalidReference(): never {
  throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Provider reservation reference is invalid.');
}

export function normalizeTravelportStaysReservationReference(value: unknown) {
  if (typeof value !== 'string') {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Provider reservation reference is required.');
  }
  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || normalized.length > MAX_RESERVATION_REFERENCE_LENGTH
    || !normalized.isWellFormed()
    || ASCII_CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    invalidReference();
  }
  return normalized;
}

export function isCanonicalTravelportStaysReservationReferencePathSegment(value: string) {
  if (!value || value.includes('/')) return false;

  let reference: string;
  try {
    reference = decodeURIComponent(value);
    normalizeTravelportStaysReservationReference(reference);
  } catch {
    return false;
  }

  return encodeURIComponent(reference) === value;
}
