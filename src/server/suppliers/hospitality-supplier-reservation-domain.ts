import { createHash } from 'node:crypto';

import { normalizeIntegrationProviderCode } from '../integrations/integration-domain.ts';
import { normalizeCurrency } from '../pricing/money.ts';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const MAX_REFERENCE_LENGTH = 4_096;
const MAX_CORRELATION_LENGTH = 512;
const MAX_FAILURE_CODE_LENGTH = 64;
const MAX_ROOMS = 16;
const MAX_GUESTS = 64;
const MAX_CHILDREN = 32;
const MAX_TOTAL_MINOR = 9_000_000_000_000_000n;

export const hospitalitySupplierReservationStatuses = [
  'PREPARED',
  'SUBMITTING',
  'CONFIRMED',
  'AMBIGUOUS',
  'RECONCILING',
  'FAILED',
] as const;

export type HospitalitySupplierReservationStatus = (typeof hospitalitySupplierReservationStatuses)[number];

export class HospitalitySupplierReservationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalitySupplierReservationValidationError';
  }
}

export class HospitalitySupplierReservationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalitySupplierReservationConflictError';
  }
}

export type HospitalitySupplierReservationSelectionInput = Readonly<{
  providerCode: unknown;
  supplierPropertyReference: unknown;
  supplierOfferReference: unknown;
  offerFingerprint: unknown;
  termsFingerprint: unknown;
  reservationAuthorityFingerprint: unknown;
  reservationPayloadFingerprint: unknown;
  currency: unknown;
  expectedTotalMinor: unknown;
  arrivalDateLocal: unknown;
  departureDateLocal: unknown;
  rooms: unknown;
  adults: unknown;
  childAges?: unknown;
}>;

export type NormalizedHospitalitySupplierReservationSelection = Readonly<{
  providerCode: string;
  supplierPropertyReference: string;
  supplierOfferReference: string;
  offerFingerprint: string;
  termsFingerprint: string;
  reservationAuthorityFingerprint: string;
  reservationPayloadFingerprint: string;
  currency: string;
  expectedTotalMinor: bigint;
  arrivalDateLocal: string;
  departureDateLocal: string;
  rooms: number;
  adults: number;
  childAges: readonly number[];
}>;

function normalizeOpaqueReference(value: unknown, label: string) {
  if (typeof value !== 'string') throw new HospitalitySupplierReservationValidationError(`${label} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_REFERENCE_LENGTH || /[\r\n]/.test(normalized)) {
    throw new HospitalitySupplierReservationValidationError(`${label} is invalid.`);
  }
  return normalized;
}

function normalizeFingerprint(value: unknown, label: string) {
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) {
    throw new HospitalitySupplierReservationValidationError(`${label} is invalid.`);
  }
  return value;
}

function normalizeLocalDate(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HospitalitySupplierReservationValidationError(`${label} is invalid.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HospitalitySupplierReservationValidationError(`${label} is invalid.`);
  }
  return value;
}

function normalizeCount(value: unknown, label: string, min: number, max: number) {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new HospitalitySupplierReservationValidationError(`${label} is invalid.`);
  }
  return value as number;
}

export function normalizeHospitalitySupplierReservationIdempotencyKey(value: unknown) {
  if (typeof value !== 'string') throw new HospitalitySupplierReservationValidationError('Reservation idempotency key is required.');
  const normalized = value.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new HospitalitySupplierReservationValidationError('Reservation idempotency key is invalid.');
  }
  return normalized;
}

export function normalizeHospitalitySupplierReservationSelection(
  input: HospitalitySupplierReservationSelectionInput,
): NormalizedHospitalitySupplierReservationSelection {
  let providerCode: string;
  let currency: string;
  try {
    providerCode = normalizeIntegrationProviderCode(input.providerCode);
  } catch {
    throw new HospitalitySupplierReservationValidationError('Supplier provider code is invalid.');
  }
  try {
    currency = normalizeCurrency(typeof input.currency === 'string' ? input.currency : '');
  } catch {
    throw new HospitalitySupplierReservationValidationError('Supplier reservation currency is invalid.');
  }

  const supplierPropertyReference = normalizeOpaqueReference(input.supplierPropertyReference, 'Supplier property reference');
  const supplierOfferReference = normalizeOpaqueReference(input.supplierOfferReference, 'Supplier offer reference');
  const offerFingerprint = normalizeFingerprint(input.offerFingerprint, 'Supplier offer fingerprint');
  const termsFingerprint = normalizeFingerprint(input.termsFingerprint, 'Supplier terms fingerprint');
  const reservationAuthorityFingerprint = normalizeFingerprint(
    input.reservationAuthorityFingerprint,
    'Supplier reservation authority fingerprint',
  );
  const reservationPayloadFingerprint = normalizeFingerprint(input.reservationPayloadFingerprint, 'Supplier reservation payload fingerprint');
  const arrivalDateLocal = normalizeLocalDate(input.arrivalDateLocal, 'Arrival date');
  const departureDateLocal = normalizeLocalDate(input.departureDateLocal, 'Departure date');
  if (departureDateLocal <= arrivalDateLocal) {
    throw new HospitalitySupplierReservationValidationError('Departure date must be after arrival date.');
  }

  if (typeof input.expectedTotalMinor !== 'bigint' || input.expectedTotalMinor < 0n || input.expectedTotalMinor > MAX_TOTAL_MINOR) {
    throw new HospitalitySupplierReservationValidationError('Supplier reservation total is invalid.');
  }
  const rooms = normalizeCount(input.rooms, 'Room count', 1, MAX_ROOMS);
  const adults = normalizeCount(input.adults, 'Adult count', 1, MAX_GUESTS);
  const childAges = input.childAges === undefined ? [] : input.childAges;
  if (!Array.isArray(childAges) || childAges.length > MAX_CHILDREN) {
    throw new HospitalitySupplierReservationValidationError('Child ages are invalid.');
  }
  const normalizedChildAges = childAges.map((age) => normalizeCount(age, 'Child age', 0, 17));
  if (adults + normalizedChildAges.length > MAX_GUESTS) {
    throw new HospitalitySupplierReservationValidationError('Guest count is invalid.');
  }

  return Object.freeze({
    providerCode,
    supplierPropertyReference,
    supplierOfferReference,
    offerFingerprint,
    termsFingerprint,
    reservationAuthorityFingerprint,
    reservationPayloadFingerprint,
    currency,
    expectedTotalMinor: input.expectedTotalMinor,
    arrivalDateLocal,
    departureDateLocal,
    rooms,
    adults,
    childAges: Object.freeze(normalizedChildAges),
  });
}

export function hospitalitySupplierReservationRequestFingerprint(
  selection: NormalizedHospitalitySupplierReservationSelection,
) {
  return createHash('sha256').update([
    selection.providerCode,
    selection.supplierPropertyReference,
    selection.supplierOfferReference,
    selection.offerFingerprint,
    selection.termsFingerprint,
    selection.reservationAuthorityFingerprint,
    selection.reservationPayloadFingerprint,
    selection.currency,
    selection.expectedTotalMinor.toString(),
    selection.arrivalDateLocal,
    selection.departureDateLocal,
    String(selection.rooms),
    String(selection.adults),
    selection.childAges.join(','),
  ].join('\u001f'), 'utf8').digest('hex');
}

export function assertHospitalitySupplierReservationExactRetry(
  existing: Readonly<{ requestFingerprint: string }>,
  expectedRequestFingerprint: string,
) {
  if (!FINGERPRINT_PATTERN.test(expectedRequestFingerprint) || existing.requestFingerprint !== expectedRequestFingerprint) {
    throw new HospitalitySupplierReservationConflictError(
      'Reservation idempotency key was already used for a different supplier reservation request.',
    );
  }
}

export function assertHospitalitySupplierReservationCanSubmit(
  input: Readonly<{
    status: HospitalitySupplierReservationStatus;
    lastFailureRetryable: boolean | null;
    requestFingerprintVersion?: number | null;
  }>,
) {
  if (input.status === 'PREPARED' || (input.status === 'FAILED' && input.lastFailureRetryable === true)) {
    if (input.requestFingerprintVersion !== 2) {
      throw new HospitalitySupplierReservationConflictError(
        'Supplier reservation authority must be reviewed again before submission.',
      );
    }
    return;
  }
  if (input.status === 'AMBIGUOUS' || input.status === 'RECONCILING') {
    throw new HospitalitySupplierReservationConflictError(
      'Supplier reservation outcome is unresolved and must be reconciled before another create attempt.',
    );
  }
  if (input.status === 'SUBMITTING') {
    throw new HospitalitySupplierReservationConflictError('Supplier reservation submission is already in progress.');
  }
  if (input.status === 'CONFIRMED') {
    throw new HospitalitySupplierReservationConflictError('Supplier reservation is already confirmed.');
  }
  throw new HospitalitySupplierReservationConflictError('Supplier reservation cannot be submitted again.');
}

export function assertHospitalitySupplierReservationCanReconcile(
  status: HospitalitySupplierReservationStatus,
) {
  if (status !== 'AMBIGUOUS') {
    throw new HospitalitySupplierReservationConflictError('Only an ambiguous supplier reservation can be reconciled.');
  }
}

export function normalizeHospitalitySupplierReservationProviderReference(value: unknown) {
  if (typeof value !== 'string') throw new HospitalitySupplierReservationValidationError('Provider reservation reference is required.');
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_CORRELATION_LENGTH || /[\r\n]/.test(normalized)) {
    throw new HospitalitySupplierReservationValidationError('Provider reservation reference is invalid.');
  }
  return normalized;
}

export function normalizeHospitalitySupplierReservationCorrelationId(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new HospitalitySupplierReservationValidationError('Provider correlation ID is invalid.');
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_CORRELATION_LENGTH || /[\r\n]/.test(normalized)) {
    throw new HospitalitySupplierReservationValidationError('Provider correlation ID is invalid.');
  }
  return normalized;
}

export function normalizeHospitalitySupplierReservationFailureCode(value: unknown) {
  if (typeof value !== 'string') throw new HospitalitySupplierReservationValidationError('Supplier failure code is required.');
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_:-]{1,63}$/.test(normalized) || normalized.length > MAX_FAILURE_CODE_LENGTH) {
    throw new HospitalitySupplierReservationValidationError('Supplier failure code is invalid.');
  }
  return normalized;
}
