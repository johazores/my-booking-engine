import { randomUUID } from 'node:crypto';

import {
  emitStructuredObservationSafely,
  safeObservationClockMs,
  safeObservationDurationMs,
  safeObservationTimestamp,
} from '../observability/structured-log-safety.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRAVELPORT_STAYS_ENDPOINTS = Object.freeze({
  searchComplete: '/12/hotel/search/searchcomplete',
  rules: '/11/hotel/rules/offershospitality/buildfromrequest',
  availability: '/11/hotel/availability/catalogofferingshospitality',
  reservationBuild: '/11/hotel/book/reservations/build',
  reservationCollection: '/11/hotel/book/reservations/',
});

export type TravelportStaysOperationalLogEnvironment = 'pre-production' | 'production';

export type TravelportStaysOperationalOperation =
  | 'oauth.token'
  | 'search.complete'
  | 'search.page'
  | 'rules'
  | 'availability'
  | 'availability.page'
  | 'reservation.create'
  | 'reservation.sync'
  | 'reservation.retrieve'
  | 'unknown';

export interface StructuredTravelportStaysProviderRequestLogRecord {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  event: 'supplier.provider-request.completed';
  requestCorrelationId: string;
  providerCorrelationId: string | null;
  organizationId: string;
  integrationId: string;
  credentialVersion: number;
  provider: 'travelport-stays';
  environment: TravelportStaysOperationalLogEnvironment;
  operation: TravelportStaysOperationalOperation;
  outcome: 'succeeded' | 'rejected' | 'failed';
  statusCode: number | null;
  durationMs: number;
  failureClass: 'aborted' | 'transport' | null;
}

export type TravelportStaysOperationalLogSink = (
  record: StructuredTravelportStaysProviderRequestLogRecord,
) => void;

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  const value = init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET');
  return typeof value === 'string' ? value.toUpperCase() : 'UNKNOWN';
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return new Headers(
      init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined),
    );
  } catch {
    return new Headers();
  }
}

function hasSinglePathSegment(url: URL, prefix: string) {
  if (!url.pathname.startsWith(prefix)) return false;
  const suffix = url.pathname.slice(prefix.length);
  return suffix.length > 0 && !suffix.includes('/');
}

function classifyOperation(url: URL | null, method: string): TravelportStaysOperationalOperation {
  if (url === null) return 'unknown';

  if (method === 'POST' && url.pathname === '/oauth/token') return 'oauth.token';
  if (method === 'POST' && url.pathname === TRAVELPORT_STAYS_ENDPOINTS.searchComplete) return 'search.complete';
  if (
    method === 'GET'
    && hasSinglePathSegment(url, `${TRAVELPORT_STAYS_ENDPOINTS.searchComplete}/`)
  ) return 'search.page';
  if (method === 'POST' && url.pathname === TRAVELPORT_STAYS_ENDPOINTS.rules) return 'rules';
  if (method === 'POST' && url.pathname === TRAVELPORT_STAYS_ENDPOINTS.availability) return 'availability';
  if (
    method === 'GET'
    && hasSinglePathSegment(url, `${TRAVELPORT_STAYS_ENDPOINTS.availability}/`)
  ) return 'availability.page';
  if (method === 'POST' && url.pathname === TRAVELPORT_STAYS_ENDPOINTS.reservationBuild) return 'reservation.create';
  if (method === 'POST' && url.pathname === TRAVELPORT_STAYS_ENDPOINTS.reservationCollection) return 'reservation.sync';
  if (
    method === 'GET'
    && hasSinglePathSegment(url, TRAVELPORT_STAYS_ENDPOINTS.reservationCollection)
    && url.pathname !== TRAVELPORT_STAYS_ENDPOINTS.reservationBuild
  ) return 'reservation.retrieve';

  return 'unknown';
}

function safeParsedUrl(input: RequestInfo | URL) {
  try {
    return new URL(requestUrl(input));
  } catch {
    return null;
  }
}

function safeUuid(value: string | null, fallback: string) {
  return value !== null && UUID_PATTERN.test(value) ? value : fallback;
}

function providerCorrelationId(headers: Headers) {
  const value = headers.get('TraceId') ?? headers.get('TVP-Trace-Id');
  return value !== null && UUID_PATTERN.test(value) ? value : null;
}

function requestCorrelationId(providerCorrelation: string | null, randomUuidFactory: () => string) {
  if (providerCorrelation !== null) return providerCorrelation;
  try {
    return safeUuid(randomUuidFactory(), 'invalid-request-correlation-id');
  } catch {
    return 'invalid-request-correlation-id';
  }
}

function classifyHttpStatus(statusCode: number) {
  if (statusCode >= 500) return Object.freeze({ level: 'error' as const, outcome: 'failed' as const });
  if (statusCode >= 300) return Object.freeze({ level: 'warn' as const, outcome: 'rejected' as const });
  return Object.freeze({ level: 'info' as const, outcome: 'succeeded' as const });
}

function writeStructuredTravelportProviderRequestLog(record: StructuredTravelportStaysProviderRequestLogRecord) {
  const line = JSON.stringify(record);
  if (record.level === 'error') {
    console.error(line);
    return;
  }
  if (record.level === 'warn') {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function createTravelportStaysOperationalLogFetch(input: Readonly<{
  organizationId: string;
  integrationId: string;
  credentialVersion: number;
  environment: TravelportStaysOperationalLogEnvironment;
  fetchImpl?: typeof fetch;
  sink?: TravelportStaysOperationalLogSink;
  now?: () => Date;
  nowMs?: () => number;
  randomUuid?: () => string;
}>): typeof fetch {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sink = input.sink ?? writeStructuredTravelportProviderRequestLog;
  const now = input.now ?? (() => new Date());
  const nowMs = input.nowMs ?? Date.now;
  const randomUuidFactory = input.randomUuid ?? randomUUID;

  return (async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = safeObservationClockMs(nowMs);
    const headers = requestHeaders(requestInput, init);
    const providerCorrelation = providerCorrelationId(headers);
    const requestCorrelation = requestCorrelationId(providerCorrelation, randomUuidFactory);
    const operation = classifyOperation(safeParsedUrl(requestInput), requestMethod(requestInput, init));
    const base = {
      event: 'supplier.provider-request.completed' as const,
      requestCorrelationId: requestCorrelation,
      providerCorrelationId: providerCorrelation,
      organizationId: safeUuid(input.organizationId, 'invalid-organization-id'),
      integrationId: safeUuid(input.integrationId, 'invalid-integration-id'),
      credentialVersion: Number.isSafeInteger(input.credentialVersion) && input.credentialVersion >= 0
        ? input.credentialVersion
        : 0,
      provider: 'travelport-stays' as const,
      environment: input.environment,
      operation,
    };

    try {
      const response = await fetchImpl(requestInput, init);
      const classification = classifyHttpStatus(response.status);
      emitStructuredObservationSafely(sink, Object.freeze({
        ...base,
        timestamp: safeObservationTimestamp(now),
        level: classification.level,
        outcome: classification.outcome,
        statusCode: response.status,
        durationMs: safeObservationDurationMs(startedAt, nowMs),
        failureClass: null,
      }));
      return response;
    } catch (error) {
      const aborted = init?.signal?.aborted === true
        || (error instanceof DOMException && error.name === 'AbortError');
      emitStructuredObservationSafely(sink, Object.freeze({
        ...base,
        timestamp: safeObservationTimestamp(now),
        level: aborted ? 'warn' : 'error',
        outcome: 'failed',
        statusCode: null,
        durationMs: safeObservationDurationMs(startedAt, nowMs),
        failureClass: aborted ? 'aborted' : 'transport',
      }));
      throw error;
    }
  }) as typeof fetch;
}
