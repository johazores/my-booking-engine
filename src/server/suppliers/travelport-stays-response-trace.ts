const SF_TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_TRACE_ID_LENGTH = 120;

type RecordValue = Record<string, unknown>;

export type TravelportStaysResponseTraceEvidence = Readonly<{
  valid: boolean;
  providerCorrelationId: string | null;
}>;

function optionalRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function hasOwn(record: RecordValue, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function validBoundedTrace(value: unknown) {
  if (typeof value !== 'string') return null;
  if (!value || value.length > MAX_TRACE_ID_LENGTH || value.trim() !== value || ASCII_CONTROL_PATTERN.test(value)) return null;
  return value;
}

/**
 * Validates Travelport's response-payload trace echo for a reservation call.
 *
 * When SF sent a request trace, current Travelport Stays documentation says the
 * same value is returned in the payload as `traceId`. Reservation I/O therefore
 * treats a missing, malformed, legacy-cased, duplicated, mismatched, or
 * control-bearing echo as invalid response evidence. With no expected SF trace,
 * this helper remains a bounded parser for classifier-level/provider-fixture use.
 */
export function inspectTravelportStaysResponseTrace(input: Readonly<{
  body: unknown;
  expectedRequestCorrelationId?: string;
}>): TravelportStaysResponseTraceEvidence {
  const root = optionalRecord(input.body);
  if (!root) return Object.freeze({ valid: false, providerCorrelationId: null });

  const hasReservationResponse = hasOwn(root, 'ReservationResponse');
  const hasErrorResponse = hasOwn(root, 'ErrorResponse');
  if (hasReservationResponse === hasErrorResponse) {
    return Object.freeze({ valid: false, providerCorrelationId: null });
  }

  const response = optionalRecord(hasReservationResponse ? root.ReservationResponse : root.ErrorResponse);
  if (!response) return Object.freeze({ valid: false, providerCorrelationId: null });

  const hasCanonicalTrace = hasOwn(response, 'traceId');
  const hasLegacyTraceAlias = hasOwn(response, 'traceID');
  if (hasLegacyTraceAlias) return Object.freeze({ valid: false, providerCorrelationId: null });

  const expected = input.expectedRequestCorrelationId;
  if (expected !== undefined) {
    if (!SF_TRACE_ID_PATTERN.test(expected) || !hasCanonicalTrace) {
      return Object.freeze({ valid: false, providerCorrelationId: null });
    }
    const traceId = validBoundedTrace(response.traceId);
    if (traceId !== expected) return Object.freeze({ valid: false, providerCorrelationId: null });
    return Object.freeze({ valid: true, providerCorrelationId: traceId });
  }

  if (!hasCanonicalTrace) return Object.freeze({ valid: true, providerCorrelationId: null });
  const traceId = validBoundedTrace(response.traceId);
  if (!traceId) return Object.freeze({ valid: false, providerCorrelationId: null });
  return Object.freeze({ valid: true, providerCorrelationId: traceId });
}
