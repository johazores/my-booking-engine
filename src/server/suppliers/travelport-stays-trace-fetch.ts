import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const SF_TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRAVELPORT_STAYS_HOSTS = new Set([
  'api.pp.travelport.net',
  'api.travelport.net',
]);
const TRAVELPORT_AUTH_HOSTS = new Set([
  'auth.pp.travelport.net',
  'auth.travelport.net',
]);

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function parsedRequestUrl(input: RequestInfo | URL) {
  try {
    return new URL(requestUrl(input));
  } catch {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport request URL is invalid.');
  }
}

function assertSecureTravelportTarget(url: URL) {
  if (
    url.protocol !== 'https:'
    || (url.port !== '' && url.port !== '443')
    || url.username !== ''
    || url.password !== ''
  ) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport request target is invalid.');
  }
}

export function createTravelportStaysTraceFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const sourceHeaders = init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
    const headers = new Headers(sourceHeaders);
    const e2eTrackingId = headers.get('E2ETrackingID');
    const url = parsedRequestUrl(input);
    assertSecureTravelportTarget(url);

    if (TRAVELPORT_AUTH_HOSTS.has(url.hostname)) {
      if (
        url.pathname !== '/oauth/token'
        || url.search !== ''
        || url.hash !== ''
        || e2eTrackingId !== null
      ) {
        throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport OAuth request target is invalid.');
      }
      headers.delete('TraceId');
      headers.delete('TVP-Trace-Id');
      return fetchImpl(input, { ...init, headers });
    }

    if (!TRAVELPORT_STAYS_HOSTS.has(url.hostname)) {
      throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport request target is invalid.');
    }
    if (!e2eTrackingId?.startsWith('sf-')) {
      throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport request correlation ID is required.');
    }

    const traceId = e2eTrackingId.slice(3);
    if (!SF_TRACE_ID_PATTERN.test(traceId)) {
      throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport request correlation ID is invalid.');
    }

    if (url.pathname.startsWith('/11/hotel/')) {
      headers.set('TraceId', traceId);
      headers.delete('TVP-Trace-Id');
    } else if (url.pathname.startsWith('/12/hotel/')) {
      headers.set('TVP-Trace-Id', traceId);
      headers.delete('TraceId');
    } else {
      throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport Stays API version is unsupported.');
    }

    return fetchImpl(input, { ...init, headers });
  }) as typeof fetch;
}
