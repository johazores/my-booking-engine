import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { inspectTravelportStaysResponseTrace } from './travelport-stays-response-trace.ts';

const RESERVATION_PATH_PREFIX = '/11/hotel/book/reservations';
const SF_E2E_PREFIX = 'sf-';
const SF_TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReservationRequest = Readonly<{
  expectedTraceId: string;
}>;

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  const value = init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET');
  return value.toUpperCase();
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  const source = init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
  return new Headers(source);
}

function reservationRequest(input: RequestInfo | URL, init?: RequestInit): ReservationRequest | null {
  let url: URL;
  try {
    url = new URL(requestUrl(input));
  } catch {
    return null;
  }
  if (!url.pathname.startsWith(RESERVATION_PATH_PREFIX)) return null;
  const method = requestMethod(input, init);
  if (method !== 'POST' && method !== 'GET') return null;

  const e2eTrackingId = requestHeaders(input, init).get('E2ETrackingID');
  if (!e2eTrackingId?.startsWith(SF_E2E_PREFIX)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport reservation request correlation ID is required.');
  }
  const expectedTraceId = e2eTrackingId.slice(SF_E2E_PREFIX.length);
  if (!SF_TRACE_ID_PATTERN.test(expectedTraceId)) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport reservation request correlation ID is invalid.');
  }
  return Object.freeze({ expectedTraceId });
}

function invalidResponse(): never {
  throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport reservation response correlation is invalid.');
}

function rebuildResponse(response: Response, body: string) {
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}

/**
 * Production reservation-only correlation boundary layered over the shared
 * Travelport transport wrapper. The shared wrapper first fixes the target,
 * outbound TraceId/E2ETrackingID pair, credentials, and response size. This
 * wrapper then requires Travelport to echo that exact caller trace in both the
 * v11 response header and payload before reservation authority reaches an
 * executor or recovery parser.
 */
export function createTravelportStaysReservationTraceAuthorityFetch(fetchImpl: typeof fetch): typeof fetch {
  if (typeof fetchImpl !== 'function') {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport reservation transport is invalid.');
  }

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const reservation = reservationRequest(input, init);
    const response = await fetchImpl(input, init);
    if (!reservation) return response;

    // Authentication and rate-limit statuses, plus provider/gateway statuses
    // above 500, are status authority and must reach the caller unchanged.
    // HTTP 500 is intentionally trace-bound because Travelport's current Stays
    // error catalog uses it for structured reservation outcomes, including
    // SourceCode 13034 and validation decisions that affect commercial state.
    if (
      response.status === 401
      || response.status === 403
      || response.status === 429
      || response.status > 500
    ) {
      return response;
    }

    if (response.headers.get('traceId') !== reservation.expectedTraceId) invalidResponse();

    let rawBody: string;
    let body: unknown;
    try {
      rawBody = await response.text();
      body = JSON.parse(rawBody);
    } catch {
      invalidResponse();
    }

    const evidence = inspectTravelportStaysResponseTrace({
      body,
      expectedRequestCorrelationId: reservation.expectedTraceId,
    });
    if (!evidence.valid) invalidResponse();
    return rebuildResponse(response, rawBody);
  }) as typeof fetch;
}
