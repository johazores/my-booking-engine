import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const RESERVATION_PATH_PREFIX = '/11/hotel/book/reservations';
const MAX_RETRY_AFTER_LENGTH = 256;
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isReservationNamespace(input: RequestInfo | URL) {
  try {
    const { pathname } = new URL(requestUrl(input));
    return pathname === RESERVATION_PATH_PREFIX || pathname.startsWith(`${RESERVATION_PATH_PREFIX}/`);
  } catch {
    return false;
  }
}

function isStatusOnlyReservationResponse(status: number) {
  return status === 401 || status === 403 || status === 429 || status > 500;
}

export function boundedTravelportStaysReservationRetryAfter(value: string | null) {
  if (
    value === null
    || value.length < 1
    || value.length > MAX_RETRY_AFTER_LENGTH
    || value.trim() !== value
    || ASCII_CONTROL_PATTERN.test(value)
  ) return null;

  if (/^\d+$/.test(value)) return value;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toUTCString() !== value) return null;
  return value;
}

function cancelResponseBody(body: ReadableStream<Uint8Array> | null) {
  if (body === null) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best-effort after status-only authority has been established.
  }
}

function rebuildStatusOnlyResponse(response: Response) {
  const headers = new Headers();
  const retryAfter = boundedTravelportStaysReservationRetryAfter(response.headers.get('Retry-After'));
  if (retryAfter !== null) headers.set('Retry-After', retryAfter);
  cancelResponseBody(response.body);
  return new Response(null, {
    status: response.status,
    headers,
  });
}

/**
 * Runs inside the shared Travelport transport so reservation authentication,
 * rate-limit, and provider/gateway status-only responses are stripped before
 * generic response replay buffering inspects or consumes an irrelevant body.
 * The outer reservation trace boundary repeats the same minimization as
 * defense in depth before provider evidence reaches an executor.
 */
export function createTravelportStaysReservationStatusOnlyResponseFetch(fetchImpl: typeof fetch): typeof fetch {
  if (typeof fetchImpl !== 'function') {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport reservation transport is invalid.');
  }

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetchImpl(input, init);
    if (!isReservationNamespace(input) || !isStatusOnlyReservationResponse(response.status)) {
      return response;
    }
    return rebuildStatusOnlyResponse(response);
  }) as typeof fetch;
}
