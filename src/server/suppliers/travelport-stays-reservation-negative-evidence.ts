const AUTHORITATIVE_RESERVATION_NOT_FOUND_SOURCE_CODE = '13061';
const AUTHORITATIVE_RESERVATION_NOT_FOUND_STATUS = 400;
const MAX_PROVIDER_CORRELATION_LENGTH = 512;
const MAX_PROVIDER_MESSAGE_LENGTH = 4096;
const MAX_PROVIDER_SOURCE_LENGTH = 64;
const ASCII_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

type RecordValue = Record<string, unknown>;

export type TravelportStaysReservationNegativeEvidence = Readonly<{
  status: 'NOT_FOUND';
  providerCorrelationId: string | null;
}>;

function optionalRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function hasOwn(record: RecordValue, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function boundedProviderText(value: unknown, max: number) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) return null;
  if (!value.isWellFormed() || ASCII_CONTROL_CHARACTER_PATTERN.test(value) || value.trim() !== value) return null;
  return value;
}

function sourceCode(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  if (typeof value !== 'string' || value.trim() !== value || ASCII_CONTROL_CHARACTER_PATTERN.test(value)) return null;
  return /^\d{1,8}$/.test(value) ? value : null;
}

export function inspectTravelportStaysReservationNegativeEvidence(
  payload: unknown,
  httpStatus: number,
): TravelportStaysReservationNegativeEvidence | null {
  if (httpStatus !== AUTHORITATIVE_RESERVATION_NOT_FOUND_STATUS) return null;

  const root = optionalRecord(payload);
  if (!root || !hasOwn(root, 'ErrorResponse') || hasOwn(root, 'ReservationResponse')) return null;

  const errorResponse = optionalRecord(root.ErrorResponse);
  const result = optionalRecord(errorResponse?.Result);
  if (!errorResponse || !result || result['@type'] !== 'Result') return null;
  if (hasOwn(result, 'Errors') || hasOwn(result, 'Warning') || hasOwn(result, 'Warnings')) return null;

  const errors = result.Error;
  if (!Array.isArray(errors) || errors.length !== 1) return null;
  const error = optionalRecord(errors[0]);
  if (!error || error['@type'] !== 'ErrorDetail') return null;
  if (error.StatusCode !== AUTHORITATIVE_RESERVATION_NOT_FOUND_STATUS) return null;
  if (sourceCode(error.SourceCode) !== AUTHORITATIVE_RESERVATION_NOT_FOUND_SOURCE_CODE) return null;
  if (error.category !== 'VALIDATION' || hasOwn(error, 'Category')) return null;
  if (!boundedProviderText(error.SourceID, MAX_PROVIDER_SOURCE_LENGTH)) return null;
  if (!boundedProviderText(error.Message, MAX_PROVIDER_MESSAGE_LENGTH)) return null;

  let providerCorrelationId: string | null = null;
  if (hasOwn(errorResponse, 'traceId') || hasOwn(errorResponse, 'traceID')) {
    if (hasOwn(errorResponse, 'traceId') && hasOwn(errorResponse, 'traceID')) return null;
    const rawCorrelationId = hasOwn(errorResponse, 'traceId') ? errorResponse.traceId : errorResponse.traceID;
    providerCorrelationId = boundedProviderText(rawCorrelationId, MAX_PROVIDER_CORRELATION_LENGTH);
    if (!providerCorrelationId) return null;
  }

  return Object.freeze({ status: 'NOT_FOUND', providerCorrelationId });
}
