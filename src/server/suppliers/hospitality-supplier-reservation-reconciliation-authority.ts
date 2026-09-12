import { isExactHospitalitySupplierMachineToken } from './hospitality-supplier-machine-token.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type {
  HospitalitySupplierReservationRecoveryProvider,
  HospitalitySupplierReservationRecoveryRequest,
  HospitalitySupplierReservationRecoveryResult,
} from './hospitality-supplier-reservation-recovery-provider.ts';

const INPUT_FAILURE_MESSAGE = 'Supplier reservation reconciliation input authority could not be materialized safely.';
const PROVIDER_FAILURE_MESSAGE = 'Supplier reservation recovery provider authority could not be materialized safely.';
const RESULT_FAILURE_MESSAGE = 'Supplier reservation recovery result authority could not be materialized safely.';
const MAX_PROVIDER_CODE_LENGTH = 64;
const MAX_OPERATIONAL_REFERENCE_LENGTH = 512;

export type HospitalitySupplierReservationReconciliationInput = Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  provider: HospitalitySupplierReservationRecoveryProvider;
}>;

export type MaterializedHospitalitySupplierReservationRecoveryProvider = Readonly<{
  code: string;
  requiresSupplierConfirmationForFound: boolean;
  retrieveReservation(
    input: HospitalitySupplierReservationRecoveryRequest,
  ): Promise<HospitalitySupplierReservationRecoveryResult>;
}>;

function fail(code: 'INVALID_REQUEST' | 'INVALID_RESPONSE', message: string): never {
  throw new HospitalitySupplierProviderError(code, message);
}

function objectRecord(value: unknown, code: 'INVALID_REQUEST' | 'INVALID_RESPONSE', message: string) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, message);
  } catch {
    fail(code, message);
  }
  return value as Record<string, unknown>;
}

function exactMachineToken(
  value: unknown,
  maxLength: number,
  code: 'INVALID_REQUEST' | 'INVALID_RESPONSE',
  message: string,
) {
  if (!isExactHospitalitySupplierMachineToken(value, maxLength)) fail(code, message);
  return value;
}

function nullableMachineToken(
  value: unknown,
  maxLength: number,
  code: 'INVALID_REQUEST' | 'INVALID_RESPONSE',
  message: string,
) {
  if (value === null) return null;
  return exactMachineToken(value, maxLength, code, message);
}

export function materializeHospitalitySupplierReservationReconciliationInput(
  input: HospitalitySupplierReservationReconciliationInput,
): HospitalitySupplierReservationReconciliationInput {
  const record = objectRecord(input, 'INVALID_REQUEST', INPUT_FAILURE_MESSAGE);
  try {
    return Object.freeze({
      organizationId: record.organizationId,
      actorUserId: record.actorUserId,
      reservationId: record.reservationId,
      provider: record.provider,
    }) as HospitalitySupplierReservationReconciliationInput;
  } catch {
    fail('INVALID_REQUEST', INPUT_FAILURE_MESSAGE);
  }
}

export function materializeHospitalitySupplierReservationRecoveryProvider(
  provider: HospitalitySupplierReservationRecoveryProvider,
): MaterializedHospitalitySupplierReservationRecoveryProvider {
  const record = objectRecord(provider, 'INVALID_REQUEST', PROVIDER_FAILURE_MESSAGE);
  let code: unknown;
  let requiresSupplierConfirmationForFound: unknown;
  let retrieveReservation: unknown;
  try {
    code = record.code;
    requiresSupplierConfirmationForFound = record.requiresSupplierConfirmationForFound;
    retrieveReservation = record.retrieveReservation;
  } catch {
    fail('INVALID_REQUEST', PROVIDER_FAILURE_MESSAGE);
  }

  if (
    !isExactHospitalitySupplierMachineToken(code, MAX_PROVIDER_CODE_LENGTH)
    || typeof retrieveReservation !== 'function'
    || (
      requiresSupplierConfirmationForFound !== undefined
      && typeof requiresSupplierConfirmationForFound !== 'boolean'
    )
  ) {
    fail('INVALID_REQUEST', PROVIDER_FAILURE_MESSAGE);
  }

  return Object.freeze({
    code,
    requiresSupplierConfirmationForFound: requiresSupplierConfirmationForFound === true,
    retrieveReservation: (request: HospitalitySupplierReservationRecoveryRequest) => (
      Reflect.apply(retrieveReservation, provider, [request]) as Promise<HospitalitySupplierReservationRecoveryResult>
    ),
  });
}

export function materializeHospitalitySupplierReservationRecoveryResult(
  result: HospitalitySupplierReservationRecoveryResult,
): HospitalitySupplierReservationRecoveryResult {
  const record = objectRecord(result, 'INVALID_RESPONSE', RESULT_FAILURE_MESSAGE);
  let status: unknown;
  let providerReservationReference: unknown;
  let supplierConfirmationReference: unknown;
  let providerCorrelationId: unknown;
  try {
    status = record.status;
    providerReservationReference = record.providerReservationReference;
    supplierConfirmationReference = record.supplierConfirmationReference;
    providerCorrelationId = record.providerCorrelationId;
  } catch {
    fail('INVALID_RESPONSE', RESULT_FAILURE_MESSAGE);
  }

  if (status !== 'FOUND' && status !== 'NOT_FOUND') {
    fail('INVALID_RESPONSE', RESULT_FAILURE_MESSAGE);
  }

  const normalizedProviderReservationReference = exactMachineToken(
    providerReservationReference,
    MAX_OPERATIONAL_REFERENCE_LENGTH,
    'INVALID_RESPONSE',
    RESULT_FAILURE_MESSAGE,
  );
  const normalizedProviderCorrelationId = nullableMachineToken(
    providerCorrelationId,
    MAX_OPERATIONAL_REFERENCE_LENGTH,
    'INVALID_RESPONSE',
    RESULT_FAILURE_MESSAGE,
  );

  if (status === 'FOUND') {
    const normalizedSupplierConfirmationReference = nullableMachineToken(
      supplierConfirmationReference,
      MAX_OPERATIONAL_REFERENCE_LENGTH,
      'INVALID_RESPONSE',
      RESULT_FAILURE_MESSAGE,
    );
    return Object.freeze({
      status,
      providerReservationReference: normalizedProviderReservationReference,
      supplierConfirmationReference: normalizedSupplierConfirmationReference,
      providerCorrelationId: normalizedProviderCorrelationId,
    });
  }

  // A NOT_FOUND result does not own supplier confirmation authority. We still
  // read and preserve any non-null contradictory value so the coordinator can
  // keep its existing durable-confirmation continuity check, but it must be a
  // bounded exact machine token before it crosses this runtime boundary.
  const normalizedContradictorySupplierConfirmationReference = supplierConfirmationReference === undefined
    ? undefined
    : nullableMachineToken(
        supplierConfirmationReference,
        MAX_OPERATIONAL_REFERENCE_LENGTH,
        'INVALID_RESPONSE',
        RESULT_FAILURE_MESSAGE,
      );
  return Object.freeze({
    status,
    providerReservationReference: normalizedProviderReservationReference,
    supplierConfirmationReference: normalizedContradictorySupplierConfirmationReference,
    providerCorrelationId: normalizedProviderCorrelationId,
  }) as HospitalitySupplierReservationRecoveryResult;
}
