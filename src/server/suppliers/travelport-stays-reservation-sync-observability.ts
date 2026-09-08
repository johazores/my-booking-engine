export type TravelportStaysReservationSyncProviderResult = 'CONFIRMED' | 'AMBIGUOUS';

export interface StructuredTravelportStaysReservationSyncLogRecord {
  timestamp: string;
  level: 'info' | 'warn';
  event: 'supplier.reservation-sync.provider-request.completed';
  requestCorrelationId: string;
  organizationId: string;
  provider: 'travelport-stays';
  operation: 'reservation.sync';
  outcome: 'confirmed' | 'ambiguous';
  durationMs: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeUuid(value: string, fallback: string) {
  return UUID_PATTERN.test(value) ? value : fallback;
}

function safeProviderResult(value: unknown): TravelportStaysReservationSyncProviderResult {
  return value === 'CONFIRMED' ? 'CONFIRMED' : 'AMBIGUOUS';
}

export function buildTravelportStaysReservationSyncLogRecord(input: Readonly<{
  requestCorrelationId: string;
  organizationId: string;
  durationMs: number;
  result: TravelportStaysReservationSyncProviderResult;
  now?: () => Date;
}>): StructuredTravelportStaysReservationSyncLogRecord {
  const result = safeProviderResult(input.result);
  return Object.freeze({
    timestamp: (input.now ?? (() => new Date()))().toISOString(),
    level: result === 'AMBIGUOUS' ? 'warn' : 'info',
    event: 'supplier.reservation-sync.provider-request.completed',
    requestCorrelationId: safeUuid(input.requestCorrelationId, 'invalid-request-correlation-id'),
    organizationId: safeUuid(input.organizationId, 'invalid-organization-id'),
    provider: 'travelport-stays',
    operation: 'reservation.sync',
    outcome: result === 'CONFIRMED' ? 'confirmed' : 'ambiguous',
    durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs)) : 0,
  });
}

function writeStructuredTravelportSyncLog(record: StructuredTravelportStaysReservationSyncLogRecord) {
  const line = JSON.stringify(record);
  if (record.level === 'warn') {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function createTravelportStaysReservationSyncProviderObservation(input: Readonly<{
  requestCorrelationId: string;
  organizationId: string;
  nowMs?: () => number;
  now?: () => Date;
}>) {
  const nowMs = input.nowMs ?? Date.now;
  const startedAt = nowMs();
  let finished = false;

  return Object.freeze({
    finish(result: TravelportStaysReservationSyncProviderResult) {
      if (finished) return null;
      finished = true;
      const record = buildTravelportStaysReservationSyncLogRecord({
        requestCorrelationId: input.requestCorrelationId,
        organizationId: input.organizationId,
        durationMs: nowMs() - startedAt,
        result,
        now: input.now,
      });
      writeStructuredTravelportSyncLog(record);
      return record;
    },
  });
}
