import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type {
  TravelportStaysCredentials,
  TravelportStaysEnvironment,
} from './travelport-stays-provider-core.ts';

const TRAVELPORT_TARGETS: Readonly<Record<
  TravelportStaysEnvironment,
  Readonly<{ authenticationHost: string; staysHost: string }>
>> = Object.freeze({
  'pre-production': Object.freeze({
    authenticationHost: 'auth.pp.travelport.net',
    staysHost: 'api.pp.travelport.net',
  }),
  production: Object.freeze({
    authenticationHost: 'auth.travelport.net',
    staysHost: 'api.travelport.net',
  }),
});

const LONG_LIVED_OAUTH_CREDENTIAL_HEADERS = Object.freeze([
  'username',
  'password',
  'client_id',
  'client_secret',
] as const);
const TRAVELPORT_STAYS_AUTHORITY_HEADERS = Object.freeze([
  'authorization',
  'xauth_travelport_accessgroup',
  ...LONG_LIVED_OAUTH_CREDENTIAL_HEADERS,
] as const);
const TRAVELPORT_OAUTH_CREDENTIAL_FIELDS = Object.freeze([
  'username',
  'password',
  'client_id',
  'client_secret',
] as const);
const TRAVELPORT_STAYS_ENDPOINTS = Object.freeze({
  searchComplete: '/12/hotel/search/searchcomplete',
  rules: '/11/hotel/rules/offershospitality/buildfromrequest',
  availability: '/11/hotel/availability/catalogofferingshospitality',
  reservationBuild: '/11/hotel/book/reservations/build',
  reservationCollection: '/11/hotel/book/reservations/',
});
const TRAVELPORT_OAUTH_TERMINAL_ALLOWED_HEADERS = Object.freeze(new Set([
  'accept',
  'content-type',
]));
const TRAVELPORT_STAYS_TERMINAL_ALLOWED_HEADERS = Object.freeze(new Set([
  'accept',
  'accept-encoding',
  'authorization',
  'cache-control',
  'content-type',
  'e2etrackingid',
  'traceid',
  'tvp-cache-control',
  'tvp-trace-id',
  'xauth_travelport_accessgroup',
]));
const MAX_TRAVELPORT_ACCESS_TOKEN_LENGTH = 16_384;
const BEARER_PREFIX = 'Bearer ';

type LongLivedOAuthCredentialHeader = (typeof LONG_LIVED_OAUTH_CREDENTIAL_HEADERS)[number];
type OAuthCredentialField = (typeof TRAVELPORT_OAUTH_CREDENTIAL_FIELDS)[number];

function invalidCredentialContainment(): never {
  throw new HospitalitySupplierProviderError(
    'INVALID_REQUEST',
    'Travelport credential authority is invalid.',
  );
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  const value = init?.method
    ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET');
  return typeof value === 'string' ? value.toUpperCase() : '';
}

function effectiveRequestBody(input: RequestInfo | URL, init?: RequestInit): BodyInit | null {
  if (init?.body != null) return init.body;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.body;
  return null;
}

function effectiveRequestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null | undefined {
  if (init?.signal !== undefined) return init.signal;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.signal;
  return undefined;
}

function terminalTravelportRequestInit(
  method: string,
  body: BodyInit | null,
  signal: AbortSignal | null | undefined,
  headers: Headers,
): RequestInit {
  const requestInit: RequestInit = {
    method,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'manual',
    referrer: '',
    referrerPolicy: 'no-referrer',
    keepalive: false,
    integrity: '',
    headers,
  };
  if (body !== null) requestInit.body = body;
  if (signal !== undefined) requestInit.signal = signal;
  return requestInit;
}

function expectedCredentialHeaderValues(
  credentials: TravelportStaysCredentials,
): Readonly<Record<LongLivedOAuthCredentialHeader, string>> {
  return Object.freeze({
    username: credentials.username,
    password: credentials.password,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
}

function expectedOAuthCredentialFieldValues(
  credentials: TravelportStaysCredentials,
): Readonly<Record<OAuthCredentialField, string>> {
  return Object.freeze({
    username: credentials.username,
    password: credentials.password,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
}

function containedStaysHeaders(
  headers: Headers,
  credentials: TravelportStaysCredentials,
): Headers {
  if (headers.get('XAUTH_TRAVELPORT_ACCESSGROUP') !== credentials.accessGroup) {
    invalidCredentialContainment();
  }

  const presentHeaders = LONG_LIVED_OAUTH_CREDENTIAL_HEADERS.filter((name) => headers.has(name));
  if (presentHeaders.length === 0) return headers;
  if (presentHeaders.length !== LONG_LIVED_OAUTH_CREDENTIAL_HEADERS.length) {
    invalidCredentialContainment();
  }

  const expected = expectedCredentialHeaderValues(credentials);
  for (const name of LONG_LIVED_OAUTH_CREDENTIAL_HEADERS) {
    if (headers.get(name) !== expected[name]) invalidCredentialContainment();
  }
  for (const name of LONG_LIVED_OAUTH_CREDENTIAL_HEADERS) headers.delete(name);
  return headers;
}

function carriesTravelportStaysAuthority(headers: Headers) {
  return TRAVELPORT_STAYS_AUTHORITY_HEADERS.some((name) => headers.has(name));
}

function assertTravelportStaysBearerAuthorization(headers: Headers) {
  const authorization = headers.get('Authorization');
  if (
    authorization === null
    || authorization.length > BEARER_PREFIX.length + MAX_TRAVELPORT_ACCESS_TOKEN_LENGTH
    || !/^Bearer \S+$/.test(authorization)
  ) {
    invalidCredentialContainment();
  }
}

function assertAllowedTerminalHeaders(headers: Headers, allowed: ReadonlySet<string>) {
  for (const name of headers.keys()) {
    if (!allowed.has(name.toLowerCase())) invalidCredentialContainment();
  }
}

function isSecureTravelportOrigin(url: URL, host: string) {
  return url.protocol === 'https:'
    && url.hostname === host
    && (url.port === '' || url.port === '443')
    && url.username === ''
    && url.password === ''
    && url.hash === '';
}

function hasCanonicalQueryEncoding(url: URL) {
  return url.search === '' || url.search === `?${url.searchParams.toString()}`;
}

function hasExactPaginationQuery(url: URL) {
  const entries = [...url.searchParams.entries()];
  return hasCanonicalQueryEncoding(url)
    && entries.length === 1
    && entries[0]?.[0] === 'pageNumber'
    && /^[2-5]$/.test(entries[0]?.[1] ?? '');
}

function hasAcceptedReservationReviewQuery(url: URL) {
  const entries = [...url.searchParams.entries()];
  if (!hasCanonicalQueryEncoding(url)) return false;
  if (entries.length === 0) return true;
  if (entries.length > 2) return false;

  const acceptedKeys = new Set(['acceptPriceChangeInd', 'acceptGuaranteeChangeInd']);
  const seen = new Set<string>();
  for (const [key, value] of entries) {
    if (!acceptedKeys.has(key) || seen.has(key) || value !== 'true') return false;
    seen.add(key);
  }
  return true;
}

function hasSingleCanonicalEncodedPathSegment(url: URL, prefix: string) {
  if (!url.pathname.startsWith(prefix)) return false;
  const suffix = url.pathname.slice(prefix.length);
  if (!suffix || suffix.includes('/')) return false;
  try {
    return encodeURIComponent(decodeURIComponent(suffix)) === suffix;
  } catch {
    return false;
  }
}

function isSupportedTravelportStaysOperation(url: URL, method: string) {
  if (
    url.pathname === TRAVELPORT_STAYS_ENDPOINTS.searchComplete
    && method === 'POST'
    && url.search === ''
  ) return true;

  if (
    hasSingleCanonicalEncodedPathSegment(url, `${TRAVELPORT_STAYS_ENDPOINTS.searchComplete}/`)
    && method === 'GET'
    && hasExactPaginationQuery(url)
  ) return true;

  if (
    url.pathname === TRAVELPORT_STAYS_ENDPOINTS.rules
    && method === 'POST'
    && url.search === ''
  ) return true;

  if (
    url.pathname === TRAVELPORT_STAYS_ENDPOINTS.availability
    && method === 'POST'
    && url.search === ''
  ) return true;

  if (
    hasSingleCanonicalEncodedPathSegment(url, `${TRAVELPORT_STAYS_ENDPOINTS.availability}/`)
    && method === 'GET'
    && hasExactPaginationQuery(url)
  ) return true;

  if (
    url.pathname === TRAVELPORT_STAYS_ENDPOINTS.reservationBuild
    && method === 'POST'
    && hasAcceptedReservationReviewQuery(url)
  ) return true;

  if (
    url.pathname === TRAVELPORT_STAYS_ENDPOINTS.reservationCollection
    && method === 'POST'
    && url.search === ''
  ) return true;

  return hasSingleCanonicalEncodedPathSegment(url, TRAVELPORT_STAYS_ENDPOINTS.reservationCollection)
    && url.pathname !== TRAVELPORT_STAYS_ENDPOINTS.reservationBuild
    && method === 'GET'
    && url.search === '';
}

function isSecureTravelportStaysTarget(url: URL, staysHost: string, method: string) {
  return isSecureTravelportOrigin(url, staysHost)
    && isSupportedTravelportStaysOperation(url, method);
}

function isSecureTravelportOAuthTarget(url: URL, authenticationHost: string) {
  return isSecureTravelportOrigin(url, authenticationHost)
    && url.pathname === '/oauth/token'
    && url.search === '';
}

function assertTravelportOAuthCredentialBody(
  body: BodyInit | null,
  credentials: TravelportStaysCredentials,
) {
  if (!(body instanceof URLSearchParams)) invalidCredentialContainment();

  const entries = [...body.entries()];
  if (entries.length !== 5) invalidCredentialContainment();

  const values = new Map<string, string>();
  for (const [key, value] of entries) {
    if (values.has(key)) invalidCredentialContainment();
    values.set(key, value);
  }

  if (values.get('grant_type') !== 'password') invalidCredentialContainment();

  const expected = expectedOAuthCredentialFieldValues(credentials);
  for (const name of TRAVELPORT_OAUTH_CREDENTIAL_FIELDS) {
    if (values.get(name) !== expected[name]) invalidCredentialContainment();
  }

  if (values.size !== TRAVELPORT_OAUTH_CREDENTIAL_FIELDS.length + 1) {
    invalidCredentialContainment();
  }
}

export function createTravelportStaysOAuthCredentialContainmentFetch(input: Readonly<{
  environment: TravelportStaysEnvironment;
  credentials: TravelportStaysCredentials;
  fetchImpl?: typeof fetch;
}>): typeof fetch {
  const targets = TRAVELPORT_TARGETS[input.environment];
  if (!targets) invalidCredentialContainment();
  const fetchImpl = input.fetchImpl ?? fetch;

  return (async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const sourceHeaders = init?.headers
      ?? (typeof Request !== 'undefined' && requestInput instanceof Request ? requestInput.headers : undefined);
    let headers: Headers;
    try {
      headers = new Headers(sourceHeaders);
    } catch {
      invalidCredentialContainment();
    }

    let url: URL;
    try {
      url = new URL(requestUrl(requestInput));
    } catch {
      invalidCredentialContainment();
    }

    const method = requestMethod(requestInput, init);
    const body = effectiveRequestBody(requestInput, init);
    const signal = effectiveRequestSignal(requestInput, init);

    if (url.hostname === targets.authenticationHost) {
      if (
        !isSecureTravelportOAuthTarget(url, targets.authenticationHost)
        || method !== 'POST'
        || carriesTravelportStaysAuthority(headers)
      ) {
        invalidCredentialContainment();
      }
      assertAllowedTerminalHeaders(headers, TRAVELPORT_OAUTH_TERMINAL_ALLOWED_HEADERS);
      assertTravelportOAuthCredentialBody(body, input.credentials);
      return fetchImpl(url.href, terminalTravelportRequestInit(method, body, signal, headers));
    }

    if (url.hostname !== targets.staysHost) invalidCredentialContainment();
    if (!isSecureTravelportStaysTarget(url, targets.staysHost, method)) invalidCredentialContainment();

    containedStaysHeaders(headers, input.credentials);
    assertTravelportStaysBearerAuthorization(headers);
    assertAllowedTerminalHeaders(headers, TRAVELPORT_STAYS_TERMINAL_ALLOWED_HEADERS);
    return fetchImpl(url.href, terminalTravelportRequestInit(method, body, signal, headers));
  }) as typeof fetch;
}
