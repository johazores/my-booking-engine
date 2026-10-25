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
  environment: TravelportStaysOperationalLogEnvironment | 'unknown';
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
  try {
    const value = init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET');
    return typeof value === 'string' ? value.toUpperCase() : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
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

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null {
  try {
    const suppliedSignal = init?.signal;
    if (suppliedSignal) return suppliedSignal;
    return typeof Request !== 'undefined' && input instanceof Request ? input.signal : null;
  } catch {
    return null;
  }
}

function safeSignalAborted(signal: AbortSignal | null) {
  try {
    return signal?.aborted === true;
  } catch {
    return false;
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

function safeUuid(value: unknown, fallback: string) {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : fallback;
}

/** Diagnostics cannot become provider authority, including at transport construction. */
function safeObservationRead(read: () => unknown): unknown {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function safeObservationHook<T>(read: () => T | undefined, fallback: T): T {
  const value = safeObservationRead(read);
  return typeof value === 'function' ? value as T : fallback;
}

function safeResponseStatus(response: Response): number | null {
  try {
    const status = response.status;
    return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  } catch {
    return null;
  }
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

function classifyHttpStatus(statusCode: number | null) {
  if (statusCode === null) return Object.freeze({ level: 'warn' as const, outcome: 'failed' as const });
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
  const sink = safeObservationHook(() => input.sink, writeStructuredTravelportProviderRequestLog);
  const now = safeObservationHook(() => input.now, () => new Date());
  const nowMs = safeObservationHook(() => input.nowMs, Date.now);
  const randomUuidFactory = safeObservationHook(() => input.randomUuid, randomUUID);
  // Pin attribution once, without allowing malformed or throwing diagnostic
  // getters to block an otherwise valid credentialed provider request.
  const organizationId = safeUuid(safeObservationRead(() => input.organizationId), 'invalid-organization-id');
  const integrationId = safeUuid(safeObservationRead(() => input.integrationId), 'invalid-integration-id');
  const version = safeObservationRead(() => input.credentialVersion);
  const credentialVersion = typeof version === 'number' && Number.isSafeInteger(version) && version >= 0 ? version : 0;
  const suppliedEnvironment = safeObservationRead(() => input.environment);
  const environment = suppliedEnvironment === 'production' || suppliedEnvironment === 'pre-production'
    ? suppliedEnvironment : 'unknown';

  return (async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = safeObservationClockMs(nowMs);
    const headers = requestHeaders(requestInput, init);
    const signal = requestSignal(requestInput, init);
    const providerCorrelation = providerCorrelationId(headers);
    const requestCorrelation = requestCorrelationId(providerCorrelation, randomUuidFactory);
    const operation = classifyOperation(safeParsedUrl(requestInput), requestMethod(requestInput, init));
    const base = {
      event: 'supplier.provider-request.completed' as const,
      requestCorrelationId: requestCorrelation,
      providerCorrelationId: providerCorrelation,
      organizationId,
      integrationId,
      credentialVersion,
      provider: 'travelport-stays' as const,
      environment,
      operation,
    };

    let response: Response;
    try {
      response = await fetchImpl(requestInput, init);
    } catch (error) {
      const aborted = safeSignalAborted(signal);
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
    // Inspect status only after the provider call has completed. A broken
    // diagnostic getter must never turn a completed Fetch into a rejection.
    const statusCode = safeResponseStatus(response);
    const classification = classifyHttpStatus(statusCode);
    emitStructuredObservationSafely(sink, Object.freeze({
      ...base,
      timestamp: safeObservationTimestamp(now),
      level: classification.level,
      outcome: classification.outcome,
      statusCode,
      durationMs: safeObservationDurationMs(startedAt, nowMs),
      failureClass: null,
    }));
    return response;
  }) as typeof fetch;
}
