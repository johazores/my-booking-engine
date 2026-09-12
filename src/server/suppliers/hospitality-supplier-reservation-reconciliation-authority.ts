import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type {
  HospitalitySupplierReservationRecoveryProvider,
  HospitalitySupplierReservationRecoveryRequest,
  HospitalitySupplierReservationRecoveryResult,
} from './hospitality-supplier-reservation-recovery-provider.ts';

const INPUT_FAILURE_MESSAGE = 'Supplier reservation reconciliation input authority could not be materialized safely.';
const PROVIDER_FAILURE_MESSAGE = 'Supplier reservation recovery provider authority could not be materialized safely.';
const RESULT_FAILURE_MESSAGE = 'Supplier reservation recovery result authority could not be materialized safely.';

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
    typeof code !== 'string'
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
  try {
    return Object.freeze({
      status: record.status,
      providerReservationReference: record.providerReservationReference,
      supplierConfirmationReference: record.supplierConfirmationReference,
      providerCorrelationId: record.providerCorrelationId,
    }) as HospitalitySupplierReservationRecoveryResult;
  } catch {
    fail('INVALID_RESPONSE', RESULT_FAILURE_MESSAGE);
  }
}
