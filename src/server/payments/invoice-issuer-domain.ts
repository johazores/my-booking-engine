import { createHash } from 'node:crypto';

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const REGISTRATION_SCHEME_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,31}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class InvoiceIssuerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceIssuerValidationError';
  }
}

export type InvoiceIssuerRegistration = Readonly<{
  scheme: string;
  identifier: string;
  countryCode: string;
}>;

export type InvoiceIssuerProfileSnapshot = Readonly<{
  schemaVersion: 1;
  legalName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  contactEmail: string | null;
  registrations: readonly InvoiceIssuerRegistration[];
}>;

function normalizedRequired(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string') throw new InvoiceIssuerValidationError(`${label} is required.`);
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength) {
    throw new InvoiceIssuerValidationError(`${label} must be between 1 and ${maxLength} characters.`);
  }
  return normalized;
}

function normalizedOptional(value: unknown, label: string, maxLength: number) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new InvoiceIssuerValidationError(`${label} is invalid.`);
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new InvoiceIssuerValidationError(`${label} must be at most ${maxLength} characters.`);
  }
  return normalized;
}

export function normalizeInvoiceIssuerCountryCode(value: unknown) {
  const normalized = normalizedRequired(value, 'countryCode', 2).toUpperCase();
  if (!COUNTRY_CODE_PATTERN.test(normalized)) {
    throw new InvoiceIssuerValidationError('countryCode must be a two-letter uppercase country code.');
  }
  return normalized;
}

function normalizeRegistration(value: unknown): InvoiceIssuerRegistration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvoiceIssuerValidationError('Each issuer registration must be an object.');
  }
  const record = value as Record<string, unknown>;
  const scheme = normalizedRequired(record.scheme, 'registration scheme', 32).toUpperCase();
  if (!REGISTRATION_SCHEME_PATTERN.test(scheme)) {
    throw new InvoiceIssuerValidationError('Registration scheme contains unsupported characters.');
  }
  const identifier = normalizedRequired(record.identifier, 'registration identifier', 120);
  const countryCode = normalizeInvoiceIssuerCountryCode(record.countryCode);
  return Object.freeze({ scheme, identifier, countryCode });
}

function normalizeRegistrations(value: unknown) {
  if (value === undefined || value === null) return Object.freeze([]) as readonly InvoiceIssuerRegistration[];
  if (!Array.isArray(value)) throw new InvoiceIssuerValidationError('registrations must be an array.');
  if (value.length > 10) throw new InvoiceIssuerValidationError('At most 10 issuer registrations are supported.');
  const registrations = value.map(normalizeRegistration);
  registrations.sort((left, right) =>
    left.countryCode.localeCompare(right.countryCode)
    || left.scheme.localeCompare(right.scheme)
    || left.identifier.localeCompare(right.identifier));
  for (let index = 1; index < registrations.length; index += 1) {
    const previous = registrations[index - 1];
    const current = registrations[index];
    if (previous && current && previous.countryCode === current.countryCode && previous.scheme === current.scheme && previous.identifier === current.identifier) {
      throw new InvoiceIssuerValidationError('Duplicate issuer registration.');
    }
  }
  return Object.freeze(registrations);
}

export function createInvoiceIssuerProfileSnapshot(input: {
  legalName: unknown;
  addressLine1: unknown;
  addressLine2?: unknown;
  city: unknown;
  region?: unknown;
  postalCode?: unknown;
  countryCode: unknown;
  contactEmail?: unknown;
  registrations?: unknown;
}): InvoiceIssuerProfileSnapshot {
  const contactEmail = normalizedOptional(input.contactEmail, 'contactEmail', 320)?.toLowerCase() ?? null;
  if (contactEmail && !EMAIL_PATTERN.test(contactEmail)) {
    throw new InvoiceIssuerValidationError('contactEmail must be a valid email address.');
  }
  const snapshot: InvoiceIssuerProfileSnapshot = {
    schemaVersion: 1,
    legalName: normalizedRequired(input.legalName, 'legalName', 200),
    addressLine1: normalizedRequired(input.addressLine1, 'addressLine1', 200),
    addressLine2: normalizedOptional(input.addressLine2, 'addressLine2', 200),
    city: normalizedRequired(input.city, 'city', 120),
    region: normalizedOptional(input.region, 'region', 120),
    postalCode: normalizedOptional(input.postalCode, 'postalCode', 32),
    countryCode: normalizeInvoiceIssuerCountryCode(input.countryCode),
    contactEmail,
    registrations: normalizeRegistrations(input.registrations),
  };
  return Object.freeze({ ...snapshot, registrations: snapshot.registrations });
}

export function parseInvoiceIssuerProfileSnapshot(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvoiceIssuerValidationError('Persisted issuer profile must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) throw new InvoiceIssuerValidationError('Unsupported issuer profile schema version.');
  return createInvoiceIssuerProfileSnapshot({
    legalName: record.legalName,
    addressLine1: record.addressLine1,
    addressLine2: record.addressLine2,
    city: record.city,
    region: record.region,
    postalCode: record.postalCode,
    countryCode: record.countryCode,
    contactEmail: record.contactEmail,
    registrations: record.registrations,
  });
}

export function invoiceIssuerProfileFingerprint(snapshot: InvoiceIssuerProfileSnapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export function createInvoiceIssuerProfile(input: Parameters<typeof createInvoiceIssuerProfileSnapshot>[0]) {
  const snapshot = createInvoiceIssuerProfileSnapshot(input);
  return Object.freeze({ snapshot, fingerprint: invoiceIssuerProfileFingerprint(snapshot) });
}
