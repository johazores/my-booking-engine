import { isExactHospitalitySupplierMachineToken } from './hospitality-supplier-machine-token.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type { TravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';
import type { TravelportStaysReservationSyncOutcome } from './travelport-stays-reservation-sync-domain.ts';

const MAX_OPERATIONAL_REFERENCE_LENGTH = 512;
const FAILURE_MESSAGE = 'Travelport reservation write outcome could not be materialized safely.';
const VALIDATION_FAILURE_CODE_PATTERN = /^TRAVELPORT_VALIDATION_(\d{1,8})$/;
const DEFINITIVE_VALIDATION_SOURCE_CODES = new Set([
  '1200', '1250', '1251', '1300', '1320', '1480', '1485', '1495', '1515',
  '1533', '1534', '1537', '1538', '1539', '1540', '1541', '1542', '1543',
  '1544', '1545', '1546', '1547', '1549', '1550', '1551', '13001', '13003',
  '13005', '13006', '13007', '13008', '13012', '13015', '13022', '13038', '13045',
  '13046', '13047', '13050', '13054', '13064', '13078', '13083',
]);
const RETRYABLE_VALIDATION_SOURCE_CODES = new Set([
  '1537', '1538', '1539', '1540', '1541', '1542', '1543', '1544', '1545', '1546',
  '1547', '13050', '13054', '13078', '13083',
]);
type ReviewReason = 'PRICE_CHANGED' | 'GUARANTEE_CHANGED' | 'PRICE_AND_GUARANTEE_CHANGED';

const REVIEW_REASONS = new Set<ReviewReason>([
  'PRICE_CHANGED',
  'GUARANTEE_CHANGED',
  'PRICE_AND_GUARANTEE_CHANGED',
]);

type UnknownRecord = Record<PropertyKey, unknown>;

function invalidResult(): never {
  throw new HospitalitySupplierProviderError('INVALID_RESPONSE', FAILURE_MESSAGE);
}

function materialize<T>(factory: () => T): T {
  try {
    return factory();
  } catch {
    invalidResult();
  }
}

function record(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalidResult();
  return value as UnknownRecord;
}

function operationalReference(value: unknown) {
  if (!isExactHospitalitySupplierMachineToken(value, MAX_OPERATIONAL_REFERENCE_LENGTH)) invalidResult();
  return value;
}

function nullableOperationalReference(value: unknown) {
  if (value === null) return null;
  return operationalReference(value);
}

function optionalOperationalReference(value: unknown) {
  if (value === undefined || value === null) return null;
  return operationalReference(value);
}

function providerCorrelationId(value: unknown) {
  if (value === null) return null;
  return operationalReference(value);
}

export function materializeTravelportStaysReservationCreateOutcome(
  value: unknown,
): TravelportStaysReservationCreateOutcome {
  return materialize(() => {
    const input = record(value);
    const status = input.status;

    if (status === 'CONFIRMED') {
      return Object.freeze({
        status,
        providerReservationReference: operationalReference(input.providerReservationReference),
        supplierConfirmationReference: nullableOperationalReference(input.supplierConfirmationReference),
        providerCorrelationId: providerCorrelationId(input.providerCorrelationId),
      });
    }

    if (status === 'FAILED') {
      const failureCode = input.failureCode;
      const retryable = input.retryable;
      if (typeof failureCode !== 'string' || typeof retryable !== 'boolean') invalidResult();
      const match = VALIDATION_FAILURE_CODE_PATTERN.exec(failureCode);
      const sourceCode = match?.[1];
      if (!sourceCode || !DEFINITIVE_VALIDATION_SOURCE_CODES.has(sourceCode)) invalidResult();
      const expectedRetryable = RETRYABLE_VALIDATION_SOURCE_CODES.has(sourceCode);
      if (retryable !== expectedRetryable) invalidResult();
      return Object.freeze({
        status,
        failureCode: failureCode as `TRAVELPORT_VALIDATION_${string}`,
        retryable: expectedRetryable,
        providerCorrelationId: providerCorrelationId(input.providerCorrelationId),
      });
    }

    if (status === 'REVIEW_REQUIRED') {
      const reason = input.reason;
      if (typeof reason !== 'string' || !REVIEW_REASONS.has(reason as ReviewReason)) invalidResult();
      return Object.freeze({
        status,
        reason: reason as ReviewReason,
        providerCorrelationId: providerCorrelationId(input.providerCorrelationId),
      });
    }

    if (status === 'AMBIGUOUS') {
      const failureCode = input.failureCode;
      if (failureCode !== 'TRAVELPORT_SYNC_REQUIRED' && failureCode !== 'INVALID_RESPONSE') invalidResult();
      return Object.freeze({
        status,
        failureCode,
        supplierConfirmationReference: nullableOperationalReference(input.supplierConfirmationReference),
        providerRecoveryReference: optionalOperationalReference(input.providerRecoveryReference),
        providerCorrelationId: providerCorrelationId(input.providerCorrelationId),
      });
    }

    invalidResult();
  });
}

export function materializeTravelportStaysReservationSyncOutcome(
  value: unknown,
): TravelportStaysReservationSyncOutcome {
  return materialize(() => {
    const input = record(value);
    const status = input.status;

    if (status === 'CONFIRMED') {
      return Object.freeze({
        status,
        providerReservationReference: operationalReference(input.providerReservationReference),
        supplierConfirmationReference: operationalReference(input.supplierConfirmationReference),
        providerCorrelationId: providerCorrelationId(input.providerCorrelationId),
      });
    }

    if (status === 'AMBIGUOUS') {
      if (input.failureCode !== 'INVALID_RESPONSE') invalidResult();
      return Object.freeze({
        status,
        failureCode: 'INVALID_RESPONSE',
        providerCorrelationId: providerCorrelationId(input.providerCorrelationId),
      });
    }

    invalidResult();
  });
}
