import { createHash } from 'node:crypto';

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const REGISTRATION_SCHEME_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,31}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class HospitalityInvoiceRecipientValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityInvoiceRecipientValidationError';
  }
}

export type HospitalityInvoiceRecipientType = 'INDIVIDUAL' | 'BUSINESS';

export type HospitalityInvoiceRecipientRegistration = Readonly<{
  scheme: string;
  identifier: string;
  countryCode: string;
}>;

export type HospitalityInvoiceRecipientSnapshot = Readonly<{
  schemaVersion: 1;
  recipientType: HospitalityInvoiceRecipientType;
  legalName: string;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  registrations: readonly HospitalityInvoiceRecipientRegistration[];
}>;

export type HospitalityInvoiceRecipientInput = Readonly<{
  recipientType: HospitalityInvoiceRecipientType;
  legalName: unknown;
  email?: unknown;
  addressLine1?: unknown;
  addressLine2?: unknown;
  city?: unknown;
  region?: unknown;
  postalCode?: unknown;
  countryCode?: unknown;
  registrations?: unknown;
}>;

function normalizedRequired(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string') throw new HospitalityInvoiceRecipientValidationError(`${label} is required.`);
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength) {
    throw new HospitalityInvoiceRecipientValidationError(`${label} must be between 1 and ${maxLength} characters.`);
  }
  return normalized;
}

function normalizedOptional(value: unknown, label: string, maxLength: number) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new HospitalityInvoiceRecipientValidationError(`${label} is invalid.`);
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new HospitalityInvoiceRecipientValidationError(`${label} must be at most ${maxLength} characters.`);
  }
  return normalized;
}

function normalizeRecipientType(value: unknown): HospitalityInvoiceRecipientType {
  if (value !== 'INDIVIDUAL' && value !== 'BUSINESS') {
    throw new HospitalityInvoiceRecipientValidationError('recipientType must be INDIVIDUAL or BUSINESS.');
  }
  return value;
}

function normalizeCountryCode(value: unknown) {
  const normalized = normalizedOptional(value, 'countryCode', 2);
  if (normalized === null) return null;
  const upper = normalized.toUpperCase();
  if (!COUNTRY_CODE_PATTERN.test(upper)) {
    throw new HospitalityInvoiceRecipientValidationError('countryCode must be a two-letter uppercase country code.');
  }
  return upper;
}

function normalizeRegistration(value: unknown): HospitalityInvoiceRecipientRegistration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HospitalityInvoiceRecipientValidationError('Each recipient registration must be an object.');
  }
  const record = value as Record<string, unknown>;
  const scheme = normalizedRequired(record.scheme, 'registration scheme', 32).toUpperCase();
  if (!REGISTRATION_SCHEME_PATTERN.test(scheme)) {
    throw new HospitalityInvoiceRecipientValidationError('Registration scheme contains unsupported characters.');
  }
  const identifier = normalizedRequired(record.identifier, 'registration identifier', 120);
  const countryCode = normalizeCountryCode(record.countryCode);
  if (!countryCode) throw new HospitalityInvoiceRecipientValidationError('registration countryCode is required.');
  return Object.freeze({ scheme, identifier, countryCode });
}

function normalizeRegistrations(value: unknown) {
  if (value === undefined || value === null) return Object.freeze([]) as readonly HospitalityInvoiceRecipientRegistration[];
  if (!Array.isArray(value)) throw new HospitalityInvoiceRecipientValidationError('registrations must be an array.');
  if (value.length > 10) throw new HospitalityInvoiceRecipientValidationError('At most 10 recipient registrations are supported.');
  const registrations = value.map(normalizeRegistration);
  registrations.sort((left, right) =>
    left.countryCode.localeCompare(right.countryCode)
    || left.scheme.localeCompare(right.scheme)
    || left.identifier.localeCompare(right.identifier));
  for (let index = 1; index < registrations.length; index += 1) {
    const previous = registrations[index - 1];
    const current = registrations[index];
    if (previous && current && previous.countryCode === current.countryCode && previous.scheme === current.scheme && previous.identifier === current.identifier) {
      throw new HospitalityInvoiceRecipientValidationError('Duplicate recipient registration.');
    }
  }
  return Object.freeze(registrations);
}

export function createHospitalityInvoiceRecipientSnapshot(input: HospitalityInvoiceRecipientInput): HospitalityInvoiceRecipientSnapshot {
  const email = normalizedOptional(input.email, 'email', 320)?.toLowerCase() ?? null;
  if (email && !EMAIL_PATTERN.test(email)) {
    throw new HospitalityInvoiceRecipientValidationError('email must be a valid email address.');
  }

  const addressLine1 = normalizedOptional(input.addressLine1, 'addressLine1', 200);
  const addressLine2 = normalizedOptional(input.addressLine2, 'addressLine2', 200);
  const city = normalizedOptional(input.city, 'city', 120);
  const region = normalizedOptional(input.region, 'region', 120);
  const postalCode = normalizedOptional(input.postalCode, 'postalCode', 32);
  const countryCode = normalizeCountryCode(input.countryCode);
  const hasAddressDetail = Boolean(addressLine1 || addressLine2 || city || region || postalCode || countryCode);
  if (hasAddressDetail && (!addressLine1 || !city || !countryCode)) {
    throw new HospitalityInvoiceRecipientValidationError(
      'Billing address evidence requires addressLine1, city, and countryCode together.',
    );
  }

  const snapshot: HospitalityInvoiceRecipientSnapshot = {
    schemaVersion: 1,
    recipientType: normalizeRecipientType(input.recipientType),
    legalName: normalizedRequired(input.legalName, 'legalName', 200),
    email,
    addressLine1,
    addressLine2,
    city,
    region,
    postalCode,
    countryCode,
    registrations: normalizeRegistrations(input.registrations),
  };
  return Object.freeze({ ...snapshot, registrations: snapshot.registrations });
}

export function parseHospitalityInvoiceRecipientSnapshot(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HospitalityInvoiceRecipientValidationError('Persisted invoice recipient must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new HospitalityInvoiceRecipientValidationError('Unsupported invoice recipient schema version.');
  }
  return createHospitalityInvoiceRecipientSnapshot({
    recipientType: record.recipientType as HospitalityInvoiceRecipientType,
    legalName: record.legalName,
    email: record.email,
    addressLine1: record.addressLine1,
    addressLine2: record.addressLine2,
    city: record.city,
    region: record.region,
    postalCode: record.postalCode,
    countryCode: record.countryCode,
    registrations: record.registrations,
  });
}

export function hospitalityInvoiceRecipientFingerprint(snapshot: HospitalityInvoiceRecipientSnapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
