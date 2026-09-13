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
const TRAVELPORT_STAYS_PATH_PREFIXES = Object.freeze([
  '/11/hotel/',
  '/12/hotel/',
] as const);

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

function isSecureTravelportOrigin(url: URL, host: string) {
  return url.protocol === 'https:'
    && url.hostname === host
    && (url.port === '' || url.port === '443')
    && url.username === ''
    && url.password === ''
    && url.hash === '';
}

function isTravelportStaysPath(url: URL) {
  return TRAVELPORT_STAYS_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isSecureTravelportStaysTarget(url: URL, staysHost: string) {
  return isSecureTravelportOrigin(url, staysHost)
    && isTravelportStaysPath(url);
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

    if (url.hostname === targets.authenticationHost) {
      if (
        !isSecureTravelportOAuthTarget(url, targets.authenticationHost)
        || requestMethod(requestInput, init) !== 'POST'
        || carriesTravelportStaysAuthority(headers)
      ) {
        invalidCredentialContainment();
      }
      assertTravelportOAuthCredentialBody(
        effectiveRequestBody(requestInput, init),
        input.credentials,
      );
      return fetchImpl(requestInput, { ...init, headers });
    }

    if (url.hostname !== targets.staysHost) invalidCredentialContainment();
    if (!isSecureTravelportStaysTarget(url, targets.staysHost)) invalidCredentialContainment();

    containedStaysHeaders(headers, input.credentials);
    return fetchImpl(requestInput, { ...init, headers });
  }) as typeof fetch;
}
