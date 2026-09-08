import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const SF_TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TRAVELPORT_STAYS_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_TRAVELPORT_OAUTH_RESPONSE_BYTES = 256 * 1024;
const MAX_TRAVELPORT_STAYS_RESPONSE_BYTES = 32 * 1024 * 1024;
const TRAVELPORT_RESPONSE_REPLAY_BLOCK_BYTES = 64 * 1024;
const MAX_TRAVELPORT_AUTHORIZATION_HEADER_LENGTH = 'Bearer '.length + 16_384;
const TRAVELPORT_OAUTH_CREDENTIAL_FIELD_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  username: 512,
  password: 4096,
  client_id: 512,
  client_secret: 4096,
});
const TRAVELPORT_STAYS_CREDENTIAL_HEADER_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  username: 512,
  password: 4096,
  client_id: 512,
  client_secret: 4096,
  xauth_travelport_accessgroup: 512,
});
const TRAVELPORT_OAUTH_ALLOWED_REQUEST_HEADERS = Object.freeze(new Set([
  'accept',
  'content-type',
  'traceid',
  'tvp-trace-id',
]));
const TRAVELPORT_STAYS_ALLOWED_REQUEST_HEADERS = Object.freeze(new Set([
  'accept',
  'accept-encoding',
  'authorization',
  'cache-control',
  'client_id',
  'client_secret',
  'content-type',
  'e2etrackingid',
  'password',
  'traceid',
  'tvp-cache-control',
  'tvp-trace-id',
  'username',
  'xauth_travelport_accessgroup',
]));
const TRAVELPORT_FORBIDDEN_REQUEST_HEADERS = Object.freeze([
  'connection',
  'content-encoding',
  'content-length',
  'content-range',
  'cookie',
  'expect',
  'forwarded',
  'host',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-range',
  'if-unmodified-since',
  'keep-alive',
  'origin',
  'proxy-authorization',
  'proxy-connection',
  'range',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
] as const);
const TRAVELPORT_OAUTH_FORBIDDEN_REQUEST_HEADERS = Object.freeze([
  'authorization',
  'client_id',
  'client_secret',
  'password',
  'username',
  'xauth_travelport_accessgroup',
] as const);
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

const TRAVELPORT_STAYS_ENDPOINTS = Object.freeze({
  searchComplete: '/12/hotel/search/searchcomplete',
  rules: '/11/hotel/rules/offershospitality/buildfromrequest',
  availability: '/11/hotel/availability/catalogofferingshospitality',
  reservationBuild: '/11/hotel/book/reservations/build',
  reservationCollection: '/11/hotel/book/reservations/',
});

type TravelportStaysTransportEnvironment = keyof typeof TRAVELPORT_TARGETS;
type TravelportStaysTransportCredentials = Readonly<{
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
  accessGroup: string;
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

function effectiveRequestBody(input: RequestInfo | URL, init?: RequestInit): BodyInit | null {
  if (init?.body != null) return init.body;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.body;
  return null;
}

function invalidTravelportRequestBody(): never {
  throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport request body is invalid.');
}

function invalidTravelportRequestHeaders(): never {
  throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport request headers are invalid.');
}

function hasExactContentType(headers: Headers, expected: string) {
  return headers.get('Content-Type')?.trim().toLowerCase() === expected;
}

function hasUtf8ByteLengthAtMost(value: string, maxBytes: number) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) bytes += 1;
    else if (codeUnit <= 0x7ff) bytes += 2;
    else if (
      codeUnit >= 0xd800
      && codeUnit <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (bytes > maxBytes) return false;
  }
  return true;
}

function isJsonWhitespace(codeUnit: number) {
  return codeUnit === 0x20 || codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d;
}

function hasJsonObjectEnvelope(value: string) {
  let start = 0;
  while (start < value.length && isJsonWhitespace(value.charCodeAt(start))) start += 1;
  if (start >= value.length || value[start] !== '{') return false;

  let end = value.length - 1;
  while (end > start && isJsonWhitespace(value.charCodeAt(end))) end -= 1;
  return value[end] === '}';
}

function assertTravelportOAuthRequestBody(
  body: BodyInit | null,
  headers: Headers,
  credentials?: TravelportStaysTransportCredentials,
) {
  if (body === null) invalidTravelportRequestBody();
  if (!(body instanceof URLSearchParams) || !hasExactContentType(headers, 'application/x-www-form-urlencoded')) {
    invalidTravelportRequestBody();
  }

  const entries = [...body.entries()];
  if (entries.length !== 5) invalidTravelportRequestBody();

  const seen = new Set<string>();
  for (const [key, value] of entries) {
    if (seen.has(key)) invalidTravelportRequestBody();
    seen.add(key);
    if (key === 'grant_type') {
      if (value !== 'password') invalidTravelportRequestBody();
      continue;
    }

    const maxLength = TRAVELPORT_OAUTH_CREDENTIAL_FIELD_LIMITS[key];
    if (
      maxLength === undefined
      || value.length === 0
      || value.length > maxLength
      || value.trim() !== value
      || /[\r\n]/.test(value)
    ) {
      invalidTravelportRequestBody();
    }
  }

  if (
    !seen.has('grant_type')
    || !seen.has('username')
    || !seen.has('password')
    || !seen.has('client_id')
    || !seen.has('client_secret')
  ) {
    invalidTravelportRequestBody();
  }

  if (
    credentials
    && (
      body.get('username') !== credentials.username
      || body.get('password') !== credentials.password
      || body.get('client_id') !== credentials.clientId
      || body.get('client_secret') !== credentials.clientSecret
    )
  ) {
    invalidTravelportRequestBody();
  }
}

function assertTravelportStaysRequestBody(body: BodyInit | null, headers: Headers, method: string) {
  if (method === 'GET') {
    if (body !== null) invalidTravelportRequestBody();
    return;
  }
  if (body === null) invalidTravelportRequestBody();
  if (
    typeof body !== 'string'
    || !hasExactContentType(headers, 'application/json')
    || !hasJsonObjectEnvelope(body)
    || !hasUtf8ByteLengthAtMost(body, MAX_TRAVELPORT_STAYS_REQUEST_BYTES)
  ) {
    invalidTravelportRequestBody();
  }
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

function assertSafeTravelportRequestHeaders(headers: Headers) {
  if (TRAVELPORT_FORBIDDEN_REQUEST_HEADERS.some((name) => headers.has(name))) {
    invalidTravelportRequestHeaders();
  }
}

function assertAllowedTravelportRequestHeaders(headers: Headers, allowed: ReadonlySet<string>) {
  for (const name of headers.keys()) {
    if (!allowed.has(name.toLowerCase())) invalidTravelportRequestHeaders();
  }
}

function assertExactOptionalHeader(headers: Headers, name: string, expected: string) {
  const value = headers.get(name);
  if (value !== null && value.trim().toLowerCase() !== expected) invalidTravelportRequestHeaders();
}

function assertBoundedOptionalHeader(headers: Headers, name: string, maxLength: number) {
  const value = headers.get(name);
  if (value !== null && (!value || value.length > maxLength || value.trim() !== value)) {
    invalidTravelportRequestHeaders();
  }
}

function assertTravelportOAuthRequestHeaders(headers: Headers) {
  assertAllowedTravelportRequestHeaders(headers, TRAVELPORT_OAUTH_ALLOWED_REQUEST_HEADERS);
  assertExactOptionalHeader(headers, 'Accept', 'application/json');
}

function assertTravelportStaysRequestHeaders(
  headers: Headers,
  url: URL,
  method: string,
  credentials?: TravelportStaysTransportCredentials,
) {
  assertAllowedTravelportRequestHeaders(headers, TRAVELPORT_STAYS_ALLOWED_REQUEST_HEADERS);
  assertExactOptionalHeader(headers, 'Accept', 'application/json');
  assertExactOptionalHeader(headers, 'Accept-Encoding', 'gzip, deflate');
  assertExactOptionalHeader(headers, 'Cache-Control', 'no-cache');
  assertExactOptionalHeader(headers, 'Content-Type', 'application/json');

  const authorization = headers.get('Authorization');
  if (
    authorization !== null
    && (
      authorization.length > MAX_TRAVELPORT_AUTHORIZATION_HEADER_LENGTH
      || !/^Bearer \S+$/.test(authorization)
    )
  ) {
    invalidTravelportRequestHeaders();
  }

  for (const [name, maxLength] of Object.entries(TRAVELPORT_STAYS_CREDENTIAL_HEADER_LIMITS)) {
    assertBoundedOptionalHeader(headers, name, maxLength);
  }

  if (
    credentials
    && (
      headers.get('username') !== credentials.username
      || headers.get('password') !== credentials.password
      || headers.get('client_id') !== credentials.clientId
      || headers.get('client_secret') !== credentials.clientSecret
      || headers.get('XAUTH_TRAVELPORT_ACCESSGROUP') !== credentials.accessGroup
    )
  ) {
    invalidTravelportRequestHeaders();
  }

  const cacheControl = headers.get('TVP-Cache-Control');
  if (
    cacheControl !== null
    && (
      cacheControl.trim().toLowerCase() !== 'no-cache'
      || method !== 'POST'
      || url.pathname !== TRAVELPORT_STAYS_ENDPOINTS.searchComplete
      || url.search !== ''
    )
  ) {
    invalidTravelportRequestHeaders();
  }
}

function hasUnsafeTravelportOAuthHeaders(headers: Headers) {
  return TRAVELPORT_OAUTH_FORBIDDEN_REQUEST_HEADERS.some((name) => headers.has(name));
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

function assertSupportedTravelportStaysRequest(url: URL, method: string) {
  if (
    url.pathname === TRAVELPORT_STAYS_ENDPOINTS.searchComplete
    && method === 'POST'
    && url.search === ''
  ) return;

  if (
    hasSingleCanonicalEncodedPathSegment(url, `${TRAVELPORT_STAYS_ENDPOINTS.searchComplete}/`)
    && method === 'GET'
    && hasExactPaginationQuery(url)
  ) return;

  if (
    url.pathname === TRAVELPORT_STAYS_ENDPOINTS.rules
    && method === 'POST'
    && url.search === ''
  ) return;

  if (
    url.pathname === TRAVELPORT_STAYS_ENDPOINTS.availability
    && method === 'POST'
    && url.search === ''
  ) return;

  if (
    hasSingleCanonicalEncodedPathSegment(url, `${TRAVELPORT_STAYS_ENDPOINTS.availability}/`)
    && method === 'GET'
    && hasExactPaginationQuery(url)
  ) return;

  if (
    url.pathname === TRAVELPORT_STAYS_ENDPOINTS.reservationBuild
    && method === 'POST'
    && hasAcceptedReservationReviewQuery(url)
  ) return;

  if (
    url.pathname === TRAVELPORT_STAYS_ENDPOINTS.reservationCollection
    && method === 'POST'
    && url.search === ''
  ) return;

  if (
    hasSingleCanonicalEncodedPathSegment(url, TRAVELPORT_STAYS_ENDPOINTS.reservationCollection)
    && url.pathname !== TRAVELPORT_STAYS_ENDPOINTS.reservationBuild
    && method === 'GET'
    && url.search === ''
  ) return;

  throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport Stays request target is invalid.');
}

function declaredTravelportResponseBytes(response: Response): number | null {
  const contentLength = response.headers.get('Content-Length');
  if (contentLength === null) return null;
  if (!/^\d+$/.test(contentLength)) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response content length is invalid.');
  }
  const value = Number(contentLength);
  if (!Number.isSafeInteger(value)) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response content length is invalid.');
  }
  return value;
}

function oversizedTravelportResponseError() {
  return new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response body exceeded the supported size.');
}

function cancelResponseBody(body: ReadableStream<Uint8Array> | null) {
  if (body === null) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best-effort after the response has already failed closed.
  }
}

function replayTravelportResponse(response: Response, blocks: readonly Uint8Array[]) {
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.delete('Content-Encoding');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of blocks) controller.enqueue(block);
      controller.close();
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function bufferTravelportResponse(response: Response, maxBytes: number): Promise<Response> {
  let declaredBytes: number | null;
  try {
    declaredBytes = declaredTravelportResponseBytes(response);
  } catch (error) {
    cancelResponseBody(response.body);
    throw error;
  }
  if (declaredBytes !== null && declaredBytes > maxBytes) {
    cancelResponseBody(response.body);
    throw oversizedTravelportResponseError();
  }
  if (response.body === null) return response;

  const reader = response.body.getReader();
  const blocks: Uint8Array[] = [];
  let currentBlock: Uint8Array | null = null;
  let currentBlockLength = 0;
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        try {
          void reader.cancel().catch(() => undefined);
        } catch {
          // Cancellation is best-effort after the response has already failed closed.
        }
        throw oversizedTravelportResponseError();
      }

      let sourceOffset = 0;
      while (sourceOffset < value.byteLength) {
        if (currentBlock === null || currentBlockLength === currentBlock.byteLength) {
          if (currentBlock !== null) blocks.push(currentBlock);
          currentBlock = new Uint8Array(Math.min(TRAVELPORT_RESPONSE_REPLAY_BLOCK_BYTES, maxBytes));
          currentBlockLength = 0;
        }
        const copyLength = Math.min(
          value.byteLength - sourceOffset,
          currentBlock.byteLength - currentBlockLength,
        );
        currentBlock.set(value.subarray(sourceOffset, sourceOffset + copyLength), currentBlockLength);
        currentBlockLength += copyLength;
        sourceOffset += copyLength;
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (currentBlock !== null && currentBlockLength > 0) {
    blocks.push(currentBlockLength === currentBlock.byteLength ? currentBlock : currentBlock.subarray(0, currentBlockLength));
  }
  return replayTravelportResponse(response, blocks);
}

function travelportRequestInit(init: RequestInit | undefined, headers: Headers): RequestInit {
  return {
    ...init,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'manual',
    referrer: '',
    referrerPolicy: 'no-referrer',
    keepalive: false,
    integrity: '',
    headers,
  };
}

export function createTravelportStaysTraceFetch(input: Readonly<{
  environment: TravelportStaysTransportEnvironment;
  credentials?: TravelportStaysTransportCredentials;
  fetchImpl?: typeof fetch;
}>): typeof fetch {
  const targets = transportTargets(input.environment);
  const fetchImpl = input.fetchImpl ?? fetch;

  return (async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const sourceHeaders = init?.headers ?? (typeof Request !== 'undefined' && requestInput instanceof Request ? requestInput.headers : undefined);
    const headers = new Headers(sourceHeaders);
    assertSafeTravelportRequestHeaders(headers);
    const e2eTrackingId = headers.get('E2ETrackingID');
    const url = parsedRequestUrl(requestInput);
    const method = requestMethod(requestInput, init);
    const body = effectiveRequestBody(requestInput, init);
    assertSecureTravelportTarget(url);

    if (url.hostname === targets.authenticationHost) {
      if (
        method !== 'POST'
        || url.pathname !== '/oauth/token'
        || url.search !== ''
        || e2eTrackingId !== null
        || hasUnsafeTravelportOAuthHeaders(headers)
      ) {
        throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport OAuth request target is invalid.');
      }
      assertTravelportOAuthRequestHeaders(headers);
      assertTravelportOAuthRequestBody(body, headers, input.credentials);
      headers.delete('TraceId');
      headers.delete('TVP-Trace-Id');
      const response = await fetchImpl(requestInput, travelportRequestInit(init, headers));
      return bufferTravelportResponse(response, MAX_TRAVELPORT_OAUTH_RESPONSE_BYTES);
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

    assertSupportedTravelportStaysRequest(url, method);
    assertTravelportStaysRequestHeaders(headers, url, method, input.credentials);
    assertTravelportStaysRequestBody(body, headers, method);

    if (url.pathname.startsWith('/11/hotel/')) {
      headers.set('TraceId', traceId);
      headers.delete('TVP-Trace-Id');
    } else {
      headers.set('TVP-Trace-Id', traceId);
      headers.delete('TraceId');
    }

    const response = await fetchImpl(requestInput, travelportRequestInit(init, headers));
    return bufferTravelportResponse(response, MAX_TRAVELPORT_STAYS_RESPONSE_BYTES);
  }) as typeof fetch;
}
