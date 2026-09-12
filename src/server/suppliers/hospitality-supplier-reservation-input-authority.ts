import { HospitalitySupplierReservationConflictError } from './hospitality-supplier-reservation-domain.ts';

const INVALID_AUTHORITY_MESSAGE = 'Supplier reservation request authority is invalid.';

type UnknownRecord = Record<PropertyKey, unknown>;

type MaterializedSelectionBase = Readonly<{
  providerCode: unknown;
  supplierPropertyReference: unknown;
  supplierOfferReference: unknown;
  offerFingerprint: unknown;
  termsFingerprint: unknown;
  reservationAuthorityFingerprint: unknown;
  currency: unknown;
  expectedTotalMinor: unknown;
  arrivalDateLocal: unknown;
  departureDateLocal: unknown;
  rooms: unknown;
  adults: unknown;
  childAges: readonly unknown[] | undefined;
}>;

type MaterializedPreparationSelection = MaterializedSelectionBase & Readonly<{
  reservationPayloadFingerprint: unknown;
}>;

type MaterializedTraveler = Readonly<{
  firstName: unknown;
  lastName: unknown;
  email: unknown;
  telephone: Readonly<{
    countryCallingCode: unknown;
    areaCode: unknown;
    subscriberNumber: unknown;
  }>;
}>;

export type MaterializedHospitalitySupplierReservationSubmissionOutcome =
  | Readonly<{
      status: 'CONFIRMED';
      providerReservationReference: unknown;
      supplierConfirmationReference: unknown;
      providerCorrelationId: unknown;
    }>
  | Readonly<{
      status: 'FAILED';
      failureCode: unknown;
      retryable: boolean;
      providerCorrelationId: unknown;
    }>
  | Readonly<{
      status: 'AMBIGUOUS';
      failureCode: unknown;
      providerReservationReference: unknown;
      supplierConfirmationReference: unknown;
      providerCorrelationId: unknown;
    }>;

export type MaterializedHospitalitySupplierReservationReconciliationOutcome =
  | Readonly<{
      status: 'FOUND';
      providerReservationReference: unknown;
      supplierConfirmationReference: unknown;
      providerCorrelationId: unknown;
    }>
  | Readonly<{
      status: 'NOT_FOUND';
      providerReservationReference: unknown;
      supplierConfirmationReference: unknown;
      providerCorrelationId: unknown;
    }>
  | Readonly<{
      status: 'UNKNOWN';
      failureCode: unknown;
      providerCorrelationId: unknown;
    }>;

function invalidAuthority(): never {
  throw new HospitalitySupplierReservationConflictError(INVALID_AUTHORITY_MESSAGE);
}

function safelyMaterialize<T>(materialize: () => T): T {
  try {
    return materialize();
  } catch {
    invalidAuthority();
  }
}

function readRecord(input: unknown): UnknownRecord {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalidAuthority();
  return input as UnknownRecord;
}

function readString(record: UnknownRecord, key: string) {
  const value = record[key];
  if (typeof value !== 'string') invalidAuthority();
  return value;
}

function materializeOptionalArray(value: unknown): readonly unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) invalidAuthority();
  return Object.freeze(Array.from(value));
}

function materializeSelectionBase(record: UnknownRecord): MaterializedSelectionBase {
  return Object.freeze({
    providerCode: record.providerCode,
    supplierPropertyReference: record.supplierPropertyReference,
    supplierOfferReference: record.supplierOfferReference,
    offerFingerprint: record.offerFingerprint,
    termsFingerprint: record.termsFingerprint,
    reservationAuthorityFingerprint: record.reservationAuthorityFingerprint,
    currency: record.currency,
    expectedTotalMinor: record.expectedTotalMinor,
    arrivalDateLocal: record.arrivalDateLocal,
    departureDateLocal: record.departureDateLocal,
    rooms: record.rooms,
    adults: record.adults,
    childAges: materializeOptionalArray(record.childAges),
  });
}

function materializePreparationSelection(input: unknown): MaterializedPreparationSelection {
  const record = readRecord(input);
  return Object.freeze({
    ...materializeSelectionBase(record),
    reservationPayloadFingerprint: record.reservationPayloadFingerprint,
  });
}

function materializeSelectionWithoutPayload(input: unknown): MaterializedSelectionBase {
  return materializeSelectionBase(readRecord(input));
}

function materializeReservationAuthoritySelection(input: unknown) {
  const record = readRecord(input);
  return Object.freeze({
    supplierPropertyReference: record.supplierPropertyReference,
    supplierOfferReference: record.supplierOfferReference,
    expectedTotalMinor: record.expectedTotalMinor,
    expectedOfferFingerprint: record.expectedOfferFingerprint,
    expectedTermsFingerprint: record.expectedTermsFingerprint,
    checkInDateLocal: record.checkInDateLocal,
    checkOutDateLocal: record.checkOutDateLocal,
    rooms: record.rooms,
    adults: record.adults,
    childAges: materializeOptionalArray(record.childAges),
    currency: record.currency,
  });
}

function materializeTraveler(input: unknown): MaterializedTraveler {
  const record = readRecord(input);
  const telephoneRecord = readRecord(record.telephone);
  return Object.freeze({
    firstName: record.firstName,
    lastName: record.lastName,
    email: record.email,
    telephone: Object.freeze({
      countryCallingCode: telephoneRecord.countryCallingCode,
      areaCode: telephoneRecord.areaCode,
      subscriberNumber: telephoneRecord.subscriberNumber,
    }),
  });
}

export function materializeHospitalitySupplierReservationScope(input: unknown) {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      reservationId: readString(record, 'reservationId'),
    });
  });
}

export function materializeHospitalitySupplierReservationPreparationInput(input: unknown) {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      integrationId: readString(record, 'integrationId'),
      idempotencyKey: record.idempotencyKey,
      selection: materializePreparationSelection(record.selection),
    });
  });
}

export function materializeHospitalitySupplierReservationSubmissionSettlementInput(input: unknown) {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    const outcomeRecord = readRecord(record.outcome);
    const status = outcomeRecord.status;
    let outcome: MaterializedHospitalitySupplierReservationSubmissionOutcome;
    if (status === 'CONFIRMED') {
      outcome = Object.freeze({
        status,
        providerReservationReference: outcomeRecord.providerReservationReference,
        supplierConfirmationReference: outcomeRecord.supplierConfirmationReference,
        providerCorrelationId: outcomeRecord.providerCorrelationId,
      });
    } else if (status === 'FAILED') {
      if (typeof outcomeRecord.retryable !== 'boolean') invalidAuthority();
      outcome = Object.freeze({
        status,
        failureCode: outcomeRecord.failureCode,
        retryable: outcomeRecord.retryable,
        providerCorrelationId: outcomeRecord.providerCorrelationId,
      });
    } else if (status === 'AMBIGUOUS') {
      outcome = Object.freeze({
        status,
        failureCode: outcomeRecord.failureCode,
        providerReservationReference: outcomeRecord.providerReservationReference,
        supplierConfirmationReference: outcomeRecord.supplierConfirmationReference,
        providerCorrelationId: outcomeRecord.providerCorrelationId,
      });
    } else {
      invalidAuthority();
    }
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      reservationId: readString(record, 'reservationId'),
      attemptId: readString(record, 'attemptId'),
      outcome,
    });
  });
}

export function materializeHospitalitySupplierReservationReconciliationSettlementInput(input: unknown) {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    const outcomeRecord = readRecord(record.outcome);
    const status = outcomeRecord.status;
    let outcome: MaterializedHospitalitySupplierReservationReconciliationOutcome;
    if (status === 'FOUND') {
      outcome = Object.freeze({
        status,
        providerReservationReference: outcomeRecord.providerReservationReference,
        supplierConfirmationReference: outcomeRecord.supplierConfirmationReference,
        providerCorrelationId: outcomeRecord.providerCorrelationId,
      });
    } else if (status === 'NOT_FOUND') {
      outcome = Object.freeze({
        status,
        providerReservationReference: outcomeRecord.providerReservationReference,
        supplierConfirmationReference: outcomeRecord.supplierConfirmationReference,
        providerCorrelationId: outcomeRecord.providerCorrelationId,
      });
    } else if (status === 'UNKNOWN') {
      outcome = Object.freeze({
        status,
        failureCode: outcomeRecord.failureCode,
        providerCorrelationId: outcomeRecord.providerCorrelationId,
      });
    } else {
      invalidAuthority();
    }
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      reservationId: readString(record, 'reservationId'),
      attemptId: readString(record, 'attemptId'),
      outcome,
    });
  });
}

export function materializeHospitalitySupplierReservationReviewRequiredInput(input: unknown) {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      reservationId: readString(record, 'reservationId'),
      attemptId: readString(record, 'attemptId'),
      failureCode: record.failureCode,
      providerCorrelationId: record.providerCorrelationId,
    });
  });
}

export function materializeHospitalitySupplierReservationReviewConsumptionInput(input: unknown) {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      reservationId: readString(record, 'reservationId'),
      attemptId: readString(record, 'attemptId'),
      expectedAcceptanceFingerprint: record.expectedAcceptanceFingerprint,
    });
  });
}

export function materializeHospitalitySupplierReservationAuthorityReviewInput(input: unknown) {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      selection: materializeReservationAuthoritySelection(record.selection),
    });
  });
}

export function materializeHospitalitySupplierReservationPreparationWithTravelerInput(input: unknown) {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      integrationId: readString(record, 'integrationId'),
      idempotencyKey: record.idempotencyKey,
      selection: materializeSelectionWithoutPayload(record.selection),
      traveler: materializeTraveler(record.traveler),
    });
  });
}

export function materializeHospitalitySupplierReservationReviewAndClaimInput(input: unknown) {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      reservationId: readString(record, 'reservationId'),
      traveler: materializeTraveler(record.traveler),
    });
  });
}

export function materializeHospitalitySupplierReservationCommercialReviewAcceptanceInput(input: unknown) {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      reservationId: readString(record, 'reservationId'),
      traveler: materializeTraveler(record.traveler),
      acceptPriceChange: record.acceptPriceChange,
      acceptGuaranteeChange: record.acceptGuaranteeChange,
    });
  });
}

export function materializeHospitalitySupplierReservationAcceptedReviewInput(input: unknown) {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      reservationId: readString(record, 'reservationId'),
      traveler: materializeTraveler(record.traveler),
      expectedAcceptanceFingerprint: record.expectedAcceptanceFingerprint,
    });
  });
}
