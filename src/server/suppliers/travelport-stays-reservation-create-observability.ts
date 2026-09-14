import {
  emitStructuredObservationSafely,
  safeObservationClockMs,
  safeObservationDurationMs,
  safeObservationTimestamp,
} from '../observability/structured-log-safety.ts';

export type TravelportStaysReservationCreateProviderResult = 'CONFIRMED' | 'FAILED' | 'REVIEW_REQUIRED' | 'AMBIGUOUS';

export interface StructuredTravelportStaysReservationCreateLogRecord {
  timestamp: string;
  level: 'info' | 'warn';
  event: 'supplier.reservation-create.provider-request.completed';
  requestCorrelationId: string;
  organizationId: string;
  provider: 'travelport-stays';
  operation: 'reservation.create';
  outcome: 'confirmed' | 'failed' | 'review-required' | 'ambiguous';
  durationMs: number;
}

export type TravelportStaysReservationCreateLogSink = (
  record: StructuredTravelportStaysReservationCreateLogRecord,
) => void;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeUuid(value: string, fallback: string) {
  return UUID_PATTERN.test(value) ? value : fallback;
}

function safeProviderResult(value: unknown): TravelportStaysReservationCreateProviderResult {
  return value === 'CONFIRMED'
    || value === 'FAILED'
    || value === 'REVIEW_REQUIRED'
    || value === 'AMBIGUOUS'
    ? value
    : 'AMBIGUOUS';
}

export function buildTravelportStaysReservationCreateLogRecord(input: Readonly<{
  requestCorrelationId: string;
  organizationId: string;
  durationMs: number;
  result: TravelportStaysReservationCreateProviderResult;
  now?: () => Date;
}>): StructuredTravelportStaysReservationCreateLogRecord {
  const result = safeProviderResult(input.result);
  const outcome = result === 'CONFIRMED'
    ? 'confirmed'
    : result === 'FAILED'
      ? 'failed'
      : result === 'REVIEW_REQUIRED'
        ? 'review-required'
        : 'ambiguous';

  return Object.freeze({
    timestamp: safeObservationTimestamp(input.now ?? (() => new Date())),
    level: result === 'AMBIGUOUS' ? 'warn' : 'info',
    event: 'supplier.reservation-create.provider-request.completed',
    requestCorrelationId: safeUuid(input.requestCorrelationId, 'invalid-request-correlation-id'),
    organizationId: safeUuid(input.organizationId, 'invalid-organization-id'),
    provider: 'travelport-stays',
    operation: 'reservation.create',
    outcome,
    durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs)) : 0,
  });
}

function writeStructuredTravelportCreateLog(record: StructuredTravelportStaysReservationCreateLogRecord) {
  const line = JSON.stringify(record);
  if (record.level === 'warn') {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function createTravelportStaysReservationCreateProviderObservation(input: Readonly<{
  requestCorrelationId: string;
  organizationId: string;
  nowMs?: () => number;
  now?: () => Date;
  sink?: TravelportStaysReservationCreateLogSink;
}>) {
  const nowMs = input.nowMs ?? Date.now;
  const startedAt = safeObservationClockMs(nowMs);
  const sink = input.sink ?? writeStructuredTravelportCreateLog;
  let finished = false;

  return Object.freeze({
    finish(result: TravelportStaysReservationCreateProviderResult) {
      if (finished) return null;
      finished = true;
      const record = buildTravelportStaysReservationCreateLogRecord({
        requestCorrelationId: input.requestCorrelationId,
        organizationId: input.organizationId,
        durationMs: safeObservationDurationMs(startedAt, nowMs),
        result,
        now: input.now,
      });
      emitStructuredObservationSafely(sink, record);
      return record;
    },
  });
}
