import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { classifyHttpResponseContentEncoding, hasInconsistentProviderResponseLength, hasUnsafeProviderResponseFraming } from '../http/response-content-encoding.ts';
import { awaitTravelportStaysOperation, isTravelportStaysSignalAborted, travelportStaysResponseAbortError } from './travelport-stays-response-deadline.ts';
import { assertTravelportStaysAbortSignalReady } from './travelport-stays-abort-signal-authority.ts';
import { materializeTravelportStaysTransportConstructorAuthority } from './travelport-stays-transport-constructor-authority.ts';
import { materializeTravelportStaysOAuthRequestBody } from './travelport-stays-oauth-request-body.ts';
import { isValidTravelportStaysJsonObjectBody } from './travelport-stays-json-request-body-authority.ts';

const SF_TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TRAVELPORT_STAYS_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_TRAVELPORT_OAUTH_RESPONSE_BYTES = 256 * 1024;
const MAX_TRAVELPORT_STAYS_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_TRAVELPORT_RESPONSE_CHUNKS = 32 * 1024;
const TRAVELPORT_RESPONSE_REPLAY_BLOCK_BYTES = 64 * 1024;
const MAX_TRAVELPORT_AUTHORIZATION_HEADER_LENGTH = 'Bearer '.length + 16_384;
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
  const initBody = init?.body;
  if (initBody != null) return initBody;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.body;
  return null;
}

function effectiveRequestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null | undefined {
  const initSignal = init?.signal;
  if (initSignal !== undefined) return initSignal;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.signal;
  return undefined;
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
): URLSearchParams {
  if (!hasExactContentType(headers, 'application/x-www-form-urlencoded')) invalidTravelportRequestBody();
  const snapshot = materializeTravelportStaysOAuthRequestBody(body);
  if (!snapshot || (credentials && (
    snapshot.credentials.username !== credentials.username
    || snapshot.credentials.password !== credentials.password
    || snapshot.credentials.client_id !== credentials.clientId
    || snapshot.credentials.client_secret !== credentials.clientSecret
  ))) invalidTravelportRequestBody();
  return snapshot.body;
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
    || !isValidTravelportStaysJsonObjectBody(body)
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


/** Capture untrusted Fetch metadata once before validating or sending credentials. */
function materializeTravelportStaysRequestMetadata(input: RequestInfo | URL, init?: RequestInit) {
  try {
    const sourceHeaders = init?.headers
      ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
    const headers = new Headers(sourceHeaders);
    const e2eTrackingId = headers.get('E2ETrackingID');
    const url = parsedRequestUrl(input);
    const method = requestMethod(input, init);
    const body = effectiveRequestBody(input, init);
    const signal = effectiveRequestSignal(input, init);
    assertTravelportStaysAbortSignalReady(signal);
    return { headers, e2eTrackingId, url, method, body, signal };
  } catch (error) {
    if (error instanceof HospitalitySupplierProviderError) throw error;
    throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport request metadata is invalid.');
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

function assertTravelportOAuthRequestHeaders(
  headers: Headers,
  requireAdapterHeaders: boolean,
) {
  assertAllowedTravelportRequestHeaders(headers, TRAVELPORT_OAUTH_ALLOWED_REQUEST_HEADERS);
  assertExactOptionalHeader(headers, 'Accept', 'application/json');
  if (requireAdapterHeaders && !headers.has('Accept')) invalidTravelportRequestHeaders();
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
      !headers.has('Accept')
      || !headers.has('Accept-Encoding')
      || !headers.has('Cache-Control')
      || !headers.has('Content-Type')
      || authorization === null
      || headers.get('username') !== credentials.username
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

function declaredTravelportResponseBytes(headers: Headers): number | null {
  const contentLength = headers.get('Content-Length');
  if (contentLength === null) return null;
  if (!/^(?:0|[1-9]\d*)$/.test(contentLength) || contentLength.length > 16) {
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

type TravelportResponseMetadata = Readonly<{
  headers: Headers;
  status: number;
  statusText: string;
}>;

function replayTravelportResponse(
  metadata: TravelportResponseMetadata,
  blocks: readonly Uint8Array[],
  bodyless = false,
) {
  const headers = new Headers(metadata.headers);
  headers.delete('Content-Length');
  headers.delete('Content-Encoding');
  const body = bodyless ? null : new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of blocks) controller.enqueue(block);
      controller.close();
    },
  });
  return new Response(body, {
    status: metadata.status,
    statusText: metadata.statusText,
    headers,
  });
}

async function bufferTravelportResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  // Snapshot response metadata once. A custom Fetch may expose changing or
  // throwing accessors; only one coherent set may authorize replay.
  let body: ReadableStream<Uint8Array> | null;
  try {
    body = response.body;
  } catch {
    if (signal && isTravelportStaysSignalAborted(signal)) throw travelportStaysResponseAbortError();
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response body metadata is invalid.');
  }
  if (signal && isTravelportStaysSignalAborted(signal)) {
    cancelResponseBody(body);
    throw travelportStaysResponseAbortError();
  }
  let metadata: TravelportResponseMetadata;
  try {
    metadata = {
      headers: new Headers(response.headers),
      status: response.status,
      statusText: response.statusText,
    };
  } catch {
    cancelResponseBody(body);
    if (signal && isTravelportStaysSignalAborted(signal)) throw travelportStaysResponseAbortError();
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response metadata is invalid.');
  }
  let declaredBytes: number | null;
  let contentEncoding: 'identity' | 'encoded';
  try {
    if (hasUnsafeProviderResponseFraming(metadata.headers, metadata.status)) {
      throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response framing is invalid.');
    }
    declaredBytes = declaredTravelportResponseBytes(metadata.headers);
    const classification = classifyHttpResponseContentEncoding(metadata.headers);
    if (classification === 'invalid') {
      throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response content encoding is invalid.');
    }
    contentEncoding = classification;
  } catch (error) {
    cancelResponseBody(body);
    if (signal && isTravelportStaysSignalAborted(signal)) throw travelportStaysResponseAbortError();
    throw error;
  }
  if (declaredBytes !== null && declaredBytes > maxBytes) {
    cancelResponseBody(body);
    if (signal && isTravelportStaysSignalAborted(signal)) throw travelportStaysResponseAbortError();
    throw oversizedTravelportResponseError();
  }
  if (body === null) {
    // A no-body response is still untrusted provider evidence. Returning the
    // original Response would bypass the snapshotted metadata and wire-header
    // cleanup used for streamed responses. HTTP 304 alone may advertise the
    // length of a selected representation without carrying that body.
    if (signal && isTravelportStaysSignalAborted(signal)) throw travelportStaysResponseAbortError();
    if (declaredBytes !== null && declaredBytes > 0 && metadata.status !== 304) {
      throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response declares a missing body.');
    }
    try {
      return replayTravelportResponse(metadata, [], true);
    } catch {
      if (signal && isTravelportStaysSignalAborted(signal)) throw travelportStaysResponseAbortError();
      throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response replay failed.');
    }
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    cancelResponseBody(body);
    if (signal && isTravelportStaysSignalAborted(signal)) throw travelportStaysResponseAbortError();
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response stream cannot be read.');
  }
  const blocks: Uint8Array[] = [];
  let currentBlock: Uint8Array | null = null;
  let currentBlockLength = 0;
  let receivedBytes = 0;
  let receivedChunks = 0;
  let failed = false;
  try {
    while (true) {
      // Do not rely on a custom Fetch/stream honoring AbortSignal. The
      // outer provider timer must also stop a permanently pending read.
      const result = await awaitTravelportStaysOperation(() => reader.read(), signal);
      let done: unknown;
      let value: unknown;
      try {
        done = result?.done;
        if (done === false) value = result.value;
      } catch {
        throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response stream result is invalid.');
      }
      if (typeof done !== 'boolean') {
        throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response stream result is invalid.');
      }
      if (done) break;
      receivedChunks += 1;
      if (receivedChunks > MAX_TRAVELPORT_RESPONSE_CHUNKS) {
        throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response stream exceeded the supported chunk count.');
      }
      if (!(value instanceof Uint8Array)) {
        throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response stream chunk is invalid.');
      }
      let chunkBytes: number;
      try {
        chunkBytes = Reflect.get(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength', value) as number;
      } catch {
        throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response stream chunk is invalid.');
      }
      if (!Number.isSafeInteger(chunkBytes)) {
        throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response stream chunk is invalid.');
      }
      if (chunkBytes === 0) continue;
      receivedBytes += chunkBytes;
      if (receivedBytes > maxBytes) throw oversizedTravelportResponseError();

      let sourceOffset = 0;
      while (sourceOffset < chunkBytes) {
        if (currentBlock === null || currentBlockLength === currentBlock.byteLength) {
          if (currentBlock !== null) blocks.push(currentBlock);
          currentBlock = new Uint8Array(Math.min(TRAVELPORT_RESPONSE_REPLAY_BLOCK_BYTES, maxBytes));
          currentBlockLength = 0;
        }
        const copyLength = Math.min(
          chunkBytes - sourceOffset,
          currentBlock.byteLength - currentBlockLength,
        );
        try {
          const view = Uint8Array.prototype.subarray.call(value, sourceOffset, sourceOffset + copyLength);
          Uint8Array.prototype.set.call(currentBlock, view, currentBlockLength);
        } catch {
          throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response stream chunk is invalid.');
        }
        currentBlockLength += copyLength;
        sourceOffset += copyLength;
      }
    }
    if (signal && isTravelportStaysSignalAborted(signal)) throw travelportStaysResponseAbortError();
    // Fetch may decode compressed bodies, but declared zero encoded bytes
    // cannot yield a nonempty decoded response.
    if (hasInconsistentProviderResponseLength(declaredBytes, receivedBytes, contentEncoding)) {
      throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response body length is inconsistent.');
    }
  } catch (error) {
    failed = true;
    // Cancellation is best-effort. Neither a rejected cancel nor a failed
    // release may replace the original provider failure or local timeout.
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      // Preserve the original error.
    }
    if (signal && isTravelportStaysSignalAborted(signal)) throw travelportStaysResponseAbortError();
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      if (!failed) {
        // A custom reader may abort the caller while failing release. Timeout
        // remains authoritative and cleanup must not block that rejection.
        try {
          void reader.cancel().catch(() => undefined);
        } catch {
          // Release failure remains the original provider evidence.
        }
        if (signal && isTravelportStaysSignalAborted(signal)) throw travelportStaysResponseAbortError();
        throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response stream release failed.');
      }
    }
  }

  if (currentBlock !== null && currentBlockLength > 0) {
    blocks.push(currentBlockLength === currentBlock.byteLength ? currentBlock : currentBlock.subarray(0, currentBlockLength));
  }
  if (signal && isTravelportStaysSignalAborted(signal)) throw travelportStaysResponseAbortError();
  try {
    return replayTravelportResponse(metadata, blocks);
  } catch {
    if (signal && isTravelportStaysSignalAborted(signal)) throw travelportStaysResponseAbortError();
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE', 'Travelport response replay failed.');
  }
}

function travelportRequestInit(
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

export function createTravelportStaysTraceFetch(input: Readonly<{
  environment: TravelportStaysTransportEnvironment;
  credentials?: TravelportStaysTransportCredentials;
  fetchImpl?: typeof fetch;
}>): typeof fetch {
  const authority = materializeTravelportStaysTransportConstructorAuthority(input);
  const targets = transportTargets(authority.environment);
  const fetchImpl = authority.fetchImpl;

  return (async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const { headers, e2eTrackingId, url, method, body, signal } =
      materializeTravelportStaysRequestMetadata(requestInput, init);
    assertSafeTravelportRequestHeaders(headers);
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
      assertTravelportOAuthRequestHeaders(headers, authority.credentials !== undefined);
      const oauthBody = assertTravelportOAuthRequestBody(body, headers, authority.credentials);
      headers.delete('TraceId');
      headers.delete('TVP-Trace-Id');
      const response = await awaitTravelportStaysOperation(
        () => fetchImpl(url.href, travelportRequestInit(method, oauthBody, signal, headers)),
        signal,
        (lateResponse) => { if (lateResponse instanceof Response) cancelResponseBody(lateResponse.body); },
      );
      return bufferTravelportResponse(response, MAX_TRAVELPORT_OAUTH_RESPONSE_BYTES, signal);
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
    assertTravelportStaysRequestHeaders(headers, url, method, authority.credentials);
    assertTravelportStaysRequestBody(body, headers, method);

    if (url.pathname.startsWith('/11/hotel/')) {
      headers.set('TraceId', traceId);
      headers.delete('TVP-Trace-Id');
    } else {
      headers.set('TVP-Trace-Id', traceId);
      headers.delete('TraceId');
    }

    const response = await awaitTravelportStaysOperation(
      () => fetchImpl(url.href, travelportRequestInit(method, body, signal, headers)),
      signal,
      (lateResponse) => { if (lateResponse instanceof Response) cancelResponseBody(lateResponse.body); },
    );
    return bufferTravelportResponse(response, MAX_TRAVELPORT_STAYS_RESPONSE_BYTES, signal);
  }) as typeof fetch;
}
