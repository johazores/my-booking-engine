import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const SF_TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRAVELPORT_TARGETS = Object.freeze({
  'pre-production': Object.freeze({
    authenticationHost: 'auth.pp.travelport.net',
    staysHost: 'api.pp.travelport.net',
  }),
  production: Object.freeze({
    authenticationHost: 'auth.travelport.net',
    staysHost: 'api.travelport.net',
  }),
});

type TravelportStaysTransportEnvironment = keyof typeof TRAVELPORT_TARGETS;

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  const value = init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET');
  return value.toUpperCase();
}

function parsedRequestUrl(input: RequestInfo | URL) {
  try {
    return new URL(requestUrl(input));
  } catch {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport request URL is invalid.');
  }
}

function transportTargets(environment: TravelportStaysTransportEnvironment) {
  const targets = TRAVELPORT_TARGETS[environment];
  if (!targets) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport transport environment is invalid.');
  }
  return targets;
}

function assertSecureTravelportTarget(url: URL) {
  if (
    url.protocol !== 'https:'
    || (url.port !== '' && url.port !== '443')
    || url.username !== ''
    || url.password !== ''
    || url.hash !== ''
  ) {
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport request target is invalid.');
  }
}

export function createTravelportStaysTraceFetch(input: Readonly<{
  environment: TravelportStaysTransportEnvironment;
  fetchImpl?: typeof fetch;
}>): typeof fetch {
  const targets = transportTargets(input.environment);
  const fetchImpl = input.fetchImpl ?? fetch;

  return (async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const sourceHeaders = init?.headers ?? (typeof Request !== 'undefined' && requestInput instanceof Request ? requestInput.headers : undefined);
    const headers = new Headers(sourceHeaders);
    const e2eTrackingId = headers.get('E2ETrackingID');
    const url = parsedRequestUrl(requestInput);
    assertSecureTravelportTarget(url);

    if (url.hostname === targets.authenticationHost) {
      if (
        requestMethod(requestInput, init) !== 'POST'
        || url.pathname !== '/oauth/token'
        || url.search !== ''
        || e2eTrackingId !== null
      ) {
        throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport OAuth request target is invalid.');
      }
      headers.delete('TraceId');
      headers.delete('TVP-Trace-Id');
      return fetchImpl(requestInput, { ...init, headers });
    }

    if (url.hostname !== targets.staysHost) {
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

    return fetchImpl(requestInput, { ...init, headers });
  }) as typeof fetch;
}
