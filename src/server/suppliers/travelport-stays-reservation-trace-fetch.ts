import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { assertTravelportStaysReservationResponseMachineAuthority } from './travelport-stays-reservation-response-authority.ts';
import { inspectTravelportStaysResponseTrace } from './travelport-stays-response-trace.ts';

const RESERVATION_PATH_PREFIX = '/11/hotel/book/reservations';
const SF_E2E_PREFIX = 'sf-';
const SF_TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_STATUS_ONLY_HEADER_VALUE_LENGTH = 256;

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

function isReservationPath(pathname: string) {
  return pathname === RESERVATION_PATH_PREFIX || pathname.startsWith(`${RESERVATION_PATH_PREFIX}/`);
}

function reservationRequest(input: RequestInfo | URL, init?: RequestInit): ReservationRequest | null {
  let url: URL;
  try {
    url = new URL(requestUrl(input));
  } catch {
    return null;
  }
  if (!isReservationPath(url.pathname)) return null;
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

function rebuildResponse(response: Response, body: BodyInit | null) {
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}

function boundedStatusOnlyHeader(value: string | null) {
  if (
    value === null
    || value.length < 1
    || value.length > MAX_STATUS_ONLY_HEADER_VALUE_LENGTH
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return null;
  return value;
}

function rebuildStatusOnlyResponse(response: Response) {
  const headers = new Headers();
  const retryAfter = boundedStatusOnlyHeader(response.headers.get('Retry-After'));
  if (retryAfter !== null) headers.set('Retry-After', retryAfter);
  return new Response(null, {
    status: response.status,
    headers,
  });
}

/**
 * Production reservation-only correlation boundary layered over the shared
 * Travelport transport wrapper. The shared wrapper first fixes the target,
 * outbound TraceId/E2ETrackingID pair, credentials, and response size. This
 * wrapper then requires Travelport to echo that exact caller trace in both the
 * v11 response header and payload and validates reservation machine authority
 * before provider evidence reaches an executor or recovery parser.
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
    // above 500, are status authority only. Their body, provider free-text
    // status, and uncorrelated metadata must not cross this authority boundary.
    // Preserve only bounded Retry-After metadata for operational backoff.
    // HTTP 500 is intentionally trace-bound because Travelport's current Stays
    // error catalog uses it for structured reservation outcomes, including
    // SourceCode 13034 and validation decisions that affect commercial state.
    if (
      response.status === 401
      || response.status === 403
      || response.status === 429
      || response.status > 500
    ) {
      return rebuildStatusOnlyResponse(response);
    }

    // Reservation is a v11 Stays API. A v12-only response trace header is
    // contradictory version evidence rather than a second correlation source.
    if (response.headers.has('TVP-Trace-Id')) invalidResponse();
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
    assertTravelportStaysReservationResponseMachineAuthority(body);
    return rebuildResponse(response, rawBody);
  }) as typeof fetch;
}
