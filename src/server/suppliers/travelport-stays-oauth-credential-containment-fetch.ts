import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type {
  TravelportStaysCredentials,
  TravelportStaysEnvironment,
} from './travelport-stays-provider-core.ts';

const TRAVELPORT_STAYS_HOSTS: Readonly<Record<TravelportStaysEnvironment, string>> = Object.freeze({
  'pre-production': 'api.pp.travelport.net',
  production: 'api.travelport.net',
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

type LongLivedOAuthCredentialHeader = (typeof LONG_LIVED_OAUTH_CREDENTIAL_HEADERS)[number];

function invalidCredentialContainment(): never {
  throw new HospitalitySupplierProviderError(
    'INVALID_REQUEST',
    'Travelport long-lived OAuth credentials cannot be sent as Stays request headers.',
  );
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
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

function isSecureTravelportStaysTarget(url: URL, staysHost: string) {
  return url.protocol === 'https:'
    && url.hostname === staysHost
    && (url.port === '' || url.port === '443')
    && url.username === ''
    && url.password === ''
    && url.hash === '';
}

export function createTravelportStaysOAuthCredentialContainmentFetch(input: Readonly<{
  environment: TravelportStaysEnvironment;
  credentials: TravelportStaysCredentials;
  fetchImpl?: typeof fetch;
}>): typeof fetch {
  const staysHost = TRAVELPORT_STAYS_HOSTS[input.environment];
  if (!staysHost) invalidCredentialContainment();
  const fetchImpl = input.fetchImpl ?? fetch;

  return (async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const sourceHeaders = init?.headers
      ?? (typeof Request !== 'undefined' && requestInput instanceof Request ? requestInput.headers : undefined);
    const headers = new Headers(sourceHeaders);
    const carriesStaysAuthority = carriesTravelportStaysAuthority(headers);

    let url: URL;
    try {
      url = new URL(requestUrl(requestInput));
    } catch {
      if (carriesStaysAuthority) invalidCredentialContainment();
      return fetchImpl(requestInput, init);
    }

    if (url.hostname !== staysHost) {
      if (carriesStaysAuthority) invalidCredentialContainment();
      return fetchImpl(requestInput, init);
    }
    if (!isSecureTravelportStaysTarget(url, staysHost)) invalidCredentialContainment();

    containedStaysHeaders(headers, input.credentials);
    return fetchImpl(requestInput, { ...init, headers });
  }) as typeof fetch;
}
