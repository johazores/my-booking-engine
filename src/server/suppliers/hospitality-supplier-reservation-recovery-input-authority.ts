import { HospitalitySupplierReservationConflictError } from './hospitality-supplier-reservation-domain.ts';

const INVALID_AUTHORITY_MESSAGE = 'Supplier reservation recovery request authority is invalid.';

type UnknownRecord = Record<PropertyKey, unknown>;

function invalidAuthority(): never {
  throw new HospitalitySupplierReservationConflictError(INVALID_AUTHORITY_MESSAGE);
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

function safelyMaterialize<T>(materialize: () => T): T {
  try {
    return materialize();
  } catch {
    invalidAuthority();
  }
}

export type HospitalitySupplierReservationRecoveryScopeAuthority = Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
}>;

export function materializeHospitalitySupplierReservationRecoveryScope(
  input: unknown,
): HospitalitySupplierReservationRecoveryScopeAuthority {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      reservationId: readString(record, 'reservationId'),
    });
  });
}

export type HospitalitySupplierReservationProviderRequestAuthority = Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  attemptId: string;
  requireFreshProviderRequest: boolean;
}>;

export function materializeHospitalitySupplierReservationProviderRequestInput(
  input: unknown,
): HospitalitySupplierReservationProviderRequestAuthority {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    const rawFreshRequirement = record.requireFreshProviderRequest;
    if (rawFreshRequirement !== undefined && typeof rawFreshRequirement !== 'boolean') invalidAuthority();
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      reservationId: readString(record, 'reservationId'),
      attemptId: readString(record, 'attemptId'),
      requireFreshProviderRequest: rawFreshRequirement ?? false,
    });
  });
}

export type HospitalitySupplierReservationRecoveryEvidenceAuthority = Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  attemptId: string;
  supplierConfirmationReference: unknown;
  providerRecoveryReference: unknown;
}>;

export function materializeHospitalitySupplierReservationRecoveryEvidenceInput(
  input: unknown,
): HospitalitySupplierReservationRecoveryEvidenceAuthority {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    const supplierConfirmationReference = record.supplierConfirmationReference;
    const providerRecoveryReference = record.providerRecoveryReference;
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      reservationId: readString(record, 'reservationId'),
      attemptId: readString(record, 'attemptId'),
      supplierConfirmationReference,
      providerRecoveryReference,
    });
  });
}

export type HospitalitySupplierReservationRecoveryWriteClaimAuthority = Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  reservationPayloadFingerprint: string;
}>;

export function materializeHospitalitySupplierReservationRecoveryWriteClaimInput(
  input: unknown,
): HospitalitySupplierReservationRecoveryWriteClaimAuthority {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    return Object.freeze({
      organizationId: readString(record, 'organizationId'),
      actorUserId: readString(record, 'actorUserId'),
      reservationId: readString(record, 'reservationId'),
      reservationPayloadFingerprint: readString(record, 'reservationPayloadFingerprint'),
    });
  });
}

export type MaterializedHospitalitySupplierReservationRecoveryWriteOutcome =
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
      providerCorrelationId: unknown;
    }>;

export type HospitalitySupplierReservationRecoveryWriteSettlementAuthority = Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  attemptId: string;
  outcome: MaterializedHospitalitySupplierReservationRecoveryWriteOutcome;
}>;

export function materializeHospitalitySupplierReservationRecoveryWriteSettlementInput(
  input: unknown,
): HospitalitySupplierReservationRecoveryWriteSettlementAuthority {
  return safelyMaterialize(() => {
    const record = readRecord(input);
    const outcomeRecord = readRecord(record.outcome);
    const status = outcomeRecord.status;
    let outcome: MaterializedHospitalitySupplierReservationRecoveryWriteOutcome;

    if (status === 'CONFIRMED') {
      outcome = Object.freeze({
        status,
        providerReservationReference: outcomeRecord.providerReservationReference,
        supplierConfirmationReference: outcomeRecord.supplierConfirmationReference,
        providerCorrelationId: outcomeRecord.providerCorrelationId,
      });
    } else if (status === 'FAILED') {
      const retryable = outcomeRecord.retryable;
      if (typeof retryable !== 'boolean') invalidAuthority();
      outcome = Object.freeze({
        status,
        failureCode: outcomeRecord.failureCode,
        retryable,
        providerCorrelationId: outcomeRecord.providerCorrelationId,
      });
    } else if (status === 'AMBIGUOUS') {
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
