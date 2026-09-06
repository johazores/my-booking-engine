import { createHash } from 'node:crypto';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const PHONE_PART_PATTERN = /^\d+$/;
const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 320;

export type HospitalitySupplierReservationTravelerPayloadInput = Readonly<{
  firstName: unknown;
  lastName: unknown;
  email: unknown;
  telephone: unknown;
}>;

export type NormalizedHospitalitySupplierReservationTravelerPayload = Readonly<{
  firstName: string;
  lastName: string;
  email: string;
  telephone: Readonly<{
    countryCallingCode: string;
    areaCode: string;
    subscriberNumber: string;
  }>;
}>;

export class HospitalitySupplierReservationTravelerAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalitySupplierReservationTravelerAuthorityError';
  }
}

function boundedText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string') {
    throw new HospitalitySupplierReservationTravelerAuthorityError(`${label} is required.`);
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new HospitalitySupplierReservationTravelerAuthorityError(`${label} is invalid.`);
  }
  return normalized;
}

function phonePart(value: unknown, label: string, minLength: number, maxLength: number) {
  if (typeof value !== 'string') {
    throw new HospitalitySupplierReservationTravelerAuthorityError(`${label} is required.`);
  }
  const normalized = value.trim();
  if (
    normalized.length < minLength
    || normalized.length > maxLength
    || !PHONE_PART_PATTERN.test(normalized)
  ) {
    throw new HospitalitySupplierReservationTravelerAuthorityError(`${label} is invalid.`);
  }
  return normalized;
}

export function normalizeHospitalitySupplierReservationTravelerPayload(
  input: HospitalitySupplierReservationTravelerPayloadInput,
): NormalizedHospitalitySupplierReservationTravelerPayload {
  const firstName = boundedText(input.firstName, 'Primary traveler first name', MAX_NAME_LENGTH);
  const lastName = boundedText(input.lastName, 'Primary traveler last name', MAX_NAME_LENGTH);

  if (typeof input.email !== 'string') {
    throw new HospitalitySupplierReservationTravelerAuthorityError('Primary traveler email is required.');
  }
  const email = input.email.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new HospitalitySupplierReservationTravelerAuthorityError('Primary traveler email is invalid.');
  }

  if (!input.telephone || typeof input.telephone !== 'object' || Array.isArray(input.telephone)) {
    throw new HospitalitySupplierReservationTravelerAuthorityError('Primary traveler telephone is required.');
  }
  const telephoneInput = input.telephone as Record<string, unknown>;
  const telephone = Object.freeze({
    countryCallingCode: phonePart(telephoneInput.countryCallingCode, 'Telephone country calling code', 1, 4),
    areaCode: phonePart(telephoneInput.areaCode, 'Telephone area code', 1, 8),
    subscriberNumber: phonePart(telephoneInput.subscriberNumber, 'Telephone subscriber number', 3, 20),
  });

  return Object.freeze({ firstName, lastName, email, telephone });
}

export function hospitalitySupplierReservationTravelerPayloadFingerprint(
  input: HospitalitySupplierReservationTravelerPayloadInput | NormalizedHospitalitySupplierReservationTravelerPayload,
) {
  const traveler = normalizeHospitalitySupplierReservationTravelerPayload(input);
  return createHash('sha256').update([
    'sf-hospitality-supplier-primary-traveler-v1',
    traveler.firstName,
    traveler.lastName,
    traveler.email,
    traveler.telephone.countryCallingCode,
    traveler.telephone.areaCode,
    traveler.telephone.subscriberNumber,
  ].join('\u001f'), 'utf8').digest('hex');
}

export function assertHospitalitySupplierReservationTravelerPayloadAuthority(input: {
  expectedFingerprint: unknown;
  traveler: HospitalitySupplierReservationTravelerPayloadInput;
}) {
  if (typeof input.expectedFingerprint !== 'string' || !FINGERPRINT_PATTERN.test(input.expectedFingerprint)) {
    throw new HospitalitySupplierReservationTravelerAuthorityError(
      'Supplier reservation traveler authority fingerprint is invalid.',
    );
  }
  const traveler = normalizeHospitalitySupplierReservationTravelerPayload(input.traveler);
  const fingerprint = hospitalitySupplierReservationTravelerPayloadFingerprint(traveler);
  if (fingerprint !== input.expectedFingerprint) {
    throw new HospitalitySupplierReservationTravelerAuthorityError(
      'Primary traveler details changed after the supplier reservation request was prepared.',
    );
  }
  return traveler;
}
