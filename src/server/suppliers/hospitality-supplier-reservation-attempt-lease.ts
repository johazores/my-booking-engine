export const HOSPITALITY_SUPPLIER_RESERVATION_ATTEMPT_LEASE_MS = 10 * 60_000;
export const HOSPITALITY_SUPPLIER_RESERVATION_PRE_PROVIDER_LEASE_EXPIRED_FAILURE_CODE = 'EXECUTION_LEASE_EXPIRED_BEFORE_PROVIDER_REQUEST';
export const HOSPITALITY_SUPPLIER_RESERVATION_PROVIDER_LEASE_EXPIRED_FAILURE_CODE = 'EXECUTION_LEASE_EXPIRED';

export type HospitalitySupplierReservationInFlightStatus = 'SUBMITTING' | 'RECONCILING';
export type HospitalitySupplierReservationAttemptKind = 'CREATE' | 'RECONCILE';
export type HospitalitySupplierReservationAttemptStatus = 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS' | 'NOT_FOUND';

export type HospitalitySupplierReservationExpiredAttemptRecovery = Readonly<{
  operationStatus: 'PREPARED' | 'AMBIGUOUS';
  attemptStatus: 'FAILED' | 'AMBIGUOUS';
  failureCode:
    | typeof HOSPITALITY_SUPPLIER_RESERVATION_PRE_PROVIDER_LEASE_EXPIRED_FAILURE_CODE
    | typeof HOSPITALITY_SUPPLIER_RESERVATION_PROVIDER_LEASE_EXPIRED_FAILURE_CODE;
  retryable: boolean | null;
}>;

export class HospitalitySupplierReservationAttemptLeaseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalitySupplierReservationAttemptLeaseConflictError';
  }
}

function expectedAttemptKind(status: HospitalitySupplierReservationInFlightStatus): HospitalitySupplierReservationAttemptKind {
  return status === 'SUBMITTING' ? 'CREATE' : 'RECONCILE';
}

function assertValidDate(value: Date, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new HospitalitySupplierReservationAttemptLeaseConflictError(`${label} is invalid.`);
  }
}

export function assertHospitalitySupplierReservationAttemptLeaseExpired(input: Readonly<{
  operationStatus: HospitalitySupplierReservationInFlightStatus;
  attemptKind: HospitalitySupplierReservationAttemptKind;
  attemptStatus: HospitalitySupplierReservationAttemptStatus;
  attemptSequence: number;
  currentAttemptCount: number;
  startedAt: Date;
  now: Date;
}>) {
  const expectedKind = expectedAttemptKind(input.operationStatus);
  if (input.attemptKind !== expectedKind || input.attemptStatus !== 'STARTED') {
    throw new HospitalitySupplierReservationAttemptLeaseConflictError(
      'Supplier reservation operation does not have the expected active attempt.',
    );
  }
  if (
    !Number.isSafeInteger(input.attemptSequence)
    || input.attemptSequence < 1
    || !Number.isSafeInteger(input.currentAttemptCount)
    || input.currentAttemptCount < 1
    || input.attemptSequence !== input.currentAttemptCount
  ) {
    throw new HospitalitySupplierReservationAttemptLeaseConflictError(
      'Supplier reservation active attempt is no longer current.',
    );
  }

  assertValidDate(input.startedAt, 'Supplier reservation attempt start time');
  assertValidDate(input.now, 'Supplier reservation recovery time');
  const elapsedMs = input.now.getTime() - input.startedAt.getTime();
  if (elapsedMs < 0 || elapsedMs < HOSPITALITY_SUPPLIER_RESERVATION_ATTEMPT_LEASE_MS) {
    throw new HospitalitySupplierReservationAttemptLeaseConflictError(
      'Supplier reservation attempt is still within its execution lease.',
    );
  }
}

export function deriveHospitalitySupplierReservationExpiredAttemptRecovery(input: Readonly<{
  attemptKind: HospitalitySupplierReservationAttemptKind;
  providerRequestStarted: boolean;
}>): HospitalitySupplierReservationExpiredAttemptRecovery {
  if (!input.providerRequestStarted) {
    return Object.freeze({
      operationStatus: input.attemptKind === 'CREATE' ? 'PREPARED' : 'AMBIGUOUS',
      attemptStatus: 'FAILED',
      failureCode: HOSPITALITY_SUPPLIER_RESERVATION_PRE_PROVIDER_LEASE_EXPIRED_FAILURE_CODE,
      retryable: input.attemptKind === 'CREATE' ? true : null,
    });
  }

  return Object.freeze({
    operationStatus: 'AMBIGUOUS',
    attemptStatus: 'AMBIGUOUS',
    failureCode: HOSPITALITY_SUPPLIER_RESERVATION_PROVIDER_LEASE_EXPIRED_FAILURE_CODE,
    retryable: null,
  });
}
