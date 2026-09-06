import {
  hospitalitySupplierFailureCodes,
  type HospitalitySupplierFailureCode,
} from './hospitality-supplier-provider.ts';

export type HospitalitySupplierReservationProviderResult = 'FOUND' | 'NOT_FOUND';
export type HospitalitySupplierReservationProviderLogLevel = 'info' | 'warn';

export interface StructuredHospitalitySupplierReservationProviderLogRecord {
  timestamp: string;
  level: HospitalitySupplierReservationProviderLogLevel;
  event: 'supplier.reservation-recovery.provider-request.completed';
  requestCorrelationId: string;
  organizationId: string;
  provider: string;
  operation: 'reservation.retrieve';
  outcome: 'succeeded' | 'failed';
  durationMs: number;
  providerResult?: HospitalitySupplierReservationProviderResult;
  failureCode?: HospitalitySupplierFailureCode;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FAILURE_CODES = new Set<string>(hospitalitySupplierFailureCodes);

function safeUuid(value: string, fallback: string) {
  return UUID_PATTERN.test(value) ? value : fallback;
}

function safeProviderCode(value: string) {
  return PROVIDER_CODE_PATTERN.test(value) ? value : 'unknown-provider';
}

function safeFailureCode(value: HospitalitySupplierFailureCode) {
  return FAILURE_CODES.has(value) ? value : 'INVALID_RESPONSE';
}

export function buildHospitalitySupplierReservationProviderLogRecord(input: {
  requestCorrelationId: string;
  organizationId: string;
  provider: string;
  durationMs: number;
  result:
    | Readonly<{ status: 'SUCCEEDED'; providerResult: HospitalitySupplierReservationProviderResult }>
    | Readonly<{ status: 'FAILED'; failureCode: HospitalitySupplierFailureCode }>;
  now?: () => Date;
}): StructuredHospitalitySupplierReservationProviderLogRecord {
  const base = {
    timestamp: (input.now ?? (() => new Date()))().toISOString(),
    event: 'supplier.reservation-recovery.provider-request.completed' as const,
    requestCorrelationId: safeUuid(input.requestCorrelationId, 'invalid-request-correlation-id'),
    organizationId: safeUuid(input.organizationId, 'invalid-organization-id'),
    provider: safeProviderCode(input.provider),
    operation: 'reservation.retrieve' as const,
    durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs)) : 0,
  };

  if (input.result.status === 'SUCCEEDED') {
    return {
      ...base,
      level: 'info',
      outcome: 'succeeded',
      providerResult: input.result.providerResult,
    };
  }

  return {
    ...base,
    level: 'warn',
    outcome: 'failed',
    failureCode: safeFailureCode(input.result.failureCode),
  };
}

function writeStructuredSupplierProviderLog(record: StructuredHospitalitySupplierReservationProviderLogRecord) {
  const line = JSON.stringify(record);
  if (record.level === 'warn') {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function createHospitalitySupplierReservationProviderObservation(input: {
  requestCorrelationId: string;
  organizationId: string;
  provider: string;
  nowMs?: () => number;
  now?: () => Date;
}) {
  const nowMs = input.nowMs ?? Date.now;
  const startedAt = nowMs();
  let finished = false;

  return {
    finish(result:
      | Readonly<{ status: 'SUCCEEDED'; providerResult: HospitalitySupplierReservationProviderResult }>
      | Readonly<{ status: 'FAILED'; failureCode: HospitalitySupplierFailureCode }>,
    ) {
      if (finished) return null;
      finished = true;
      const record = buildHospitalitySupplierReservationProviderLogRecord({
        requestCorrelationId: input.requestCorrelationId,
        organizationId: input.organizationId,
        provider: input.provider,
        durationMs: nowMs() - startedAt,
        result,
        now: input.now,
      });
      writeStructuredSupplierProviderLog(record);
      return record;
    },
  };
}
