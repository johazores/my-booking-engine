import { PaymentProviderError } from './payment-provider.ts';

const STRIPE_API_ORIGIN = 'https://api.stripe.com';
const STRIPE_PAYMENT_INTENT_PATH = /^\/v1\/payment_intents\/pi_[A-Za-z0-9_]+$/;
const STRIPE_PAYMENT_INTENT_MUTATION_PATH = /^\/v1\/payment_intents\/pi_[A-Za-z0-9_]+\/(?:capture|cancel)$/;
const STRIPE_REFUND_PATH = /^\/v1\/refunds\/re_[A-Za-z0-9_]+$/;
const STRIPE_CHECKOUT_SESSION_PATH = /^\/v1\/checkout\/sessions\/cs_[A-Za-z0-9_]+$/;
const STRIPE_GET_HEADERS = new Set(['authorization']);
const STRIPE_POST_HEADERS = new Set(['authorization', 'content-type', 'idempotency-key']);
const MAX_STRIPE_API_REQUEST_BYTES = 256 * 1024;
const MAX_STRIPE_API_RESPONSE_BYTES = 4 * 1024 * 1024;

export type StripeApiFetch = typeof fetch;

function invalidTransportRequest(): never {
  throw new PaymentProviderError('INVALID_REQUEST', 'Stripe API transport request is outside the reviewed SF provider boundary.');
}

function invalidTransportResponse(): never {
  throw new PaymentProviderError('UNKNOWN', 'Stripe API response is outside the reviewed SF provider boundary.', true);
}

function canonicalStripeUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.toString()) : new URL(input);
  } catch {
    invalidTransportRequest();
  }
  if (
    url.origin !== STRIPE_API_ORIGIN
    || url.protocol !== 'https:'
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    invalidTransportRequest();
  }
  return url;
}

function reviewedStripeOperation(method: string, path: string): boolean {
  if (method === 'GET') {
    return path === '/v1/balance'
      || STRIPE_PAYMENT_INTENT_PATH.test(path)
      || STRIPE_REFUND_PATH.test(path)
      || STRIPE_CHECKOUT_SESSION_PATH.test(path);
  }
  if (method === 'POST') {
    return path === '/v1/payment_intents'
      || STRIPE_PAYMENT_INTENT_MUTATION_PATH.test(path)
      || path === '/v1/refunds'
      || path === '/v1/checkout/sessions';
  }
  return false;
}

function hasUtf8ByteLengthAtMost(value: string, maxBytes: number): boolean {
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

function reviewedHeaders(init: RequestInit, method: 'GET' | 'POST'): Headers {
  let headers: Headers;
  try {
    headers = new Headers(init.headers);
  } catch {
    invalidTransportRequest();
  }
  const allowed = method === 'GET' ? STRIPE_GET_HEADERS : STRIPE_POST_HEADERS;
  for (const [name] of headers) {
    if (!allowed.has(name)) invalidTransportRequest();
  }

  const authorization = headers.get('authorization');
  if (!authorization || !authorization.startsWith('Bearer sk_') || authorization.length > 4_103) {
    invalidTransportRequest();
  }

  if (method === 'GET') {
    if (init.body !== undefined && init.body !== null) invalidTransportRequest();
    return headers;
  }

  if (headers.get('content-type') !== 'application/x-www-form-urlencoded') invalidTransportRequest();
  const idempotencyKey = headers.get('idempotency-key');
  if (!idempotencyKey || idempotencyKey.length > 255 || !/^[\x21-\x7e]+$/.test(idempotencyKey)) {
    invalidTransportRequest();
  }
  if (
    typeof init.body !== 'string'
    || init.body.length === 0
    || !hasUtf8ByteLengthAtMost(init.body, MAX_STRIPE_API_REQUEST_BYTES)
  ) {
    invalidTransportRequest();
  }
  return headers;
}

function abortResponseRead(): Error {
  const error = new Error('Stripe API response body read was aborted.');
  error.name = 'AbortError';
  return error;
}

async function readStripeResponseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read();
  if (signal.aborted) throw abortResponseRead();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = <T>(callback: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      void reader.cancel().catch(() => undefined);
      reject(abortResponseRead());
    };

    signal.addEventListener('abort', onAbort, { once: true });
    reader.read().then(
      (result) => finish(resolve, result),
      (error: unknown) => finish(reject, error),
    );
  });
}

function cancelStripeResponseBody(response: Response): void {
  if (response.body !== null) void response.body.cancel().catch(() => undefined);
}

function assertStripeDeclaredResponseLength(response: Response): void {
  const value = response.headers.get('content-length');
  if (value === null) return;
  if (!/^(?:0|[1-9]\d*)$/.test(value) || value.length > 16) {
    cancelStripeResponseBody(response);
    invalidTransportResponse();
  }
  const declaredLength = Number(value);
  if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_STRIPE_API_RESPONSE_BYTES) {
    cancelStripeResponseBody(response);
    invalidTransportResponse();
  }
}

async function bufferStripeApiResponse(response: Response, signal?: AbortSignal): Promise<Response> {
  if (!(response instanceof Response)) invalidTransportResponse();
  assertStripeDeclaredResponseLength(response);
  if (signal?.aborted) {
    cancelStripeResponseBody(response);
    throw abortResponseRead();
  }
  if (response.body === null) return response;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await readStripeResponseChunk(reader, signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) invalidTransportResponse();
      totalBytes += value.byteLength;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_STRIPE_API_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        invalidTransportResponse();
      }
      chunks.push(value.slice());
    }
  } catch (error) {
    if (signal?.aborted) {
      void reader.cancel().catch(() => undefined);
      throw abortResponseRead();
    }
    throw error;
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fetchStripeApiResponse(
  fetchImpl: StripeApiFetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const response = await fetchImpl(url, init);
  return bufferStripeApiResponse(response, init.signal ?? undefined);
}

/**
 * Final server-side transport boundary for the Stripe REST calls SF currently implements.
 * It deliberately projects only reviewed Fetch fields so caller/framework metadata cannot
 * become routing, credential, redirect, caching, referrer, connection, or resource authority.
 */
export function requestStripeApi(
  fetchImpl: StripeApiFetch,
  input: string | URL,
  init: RequestInit,
): Promise<Response> {
  const url = canonicalStripeUrl(input);
  const method = init.method;
  if ((method !== 'GET' && method !== 'POST') || !reviewedStripeOperation(method, url.pathname)) {
    invalidTransportRequest();
  }
  const headers = reviewedHeaders(init, method);

  return fetchStripeApiResponse(fetchImpl, url.toString(), {
    method,
    headers,
    ...(method === 'POST' ? { body: init.body as string } : {}),
    signal: init.signal ?? undefined,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'manual',
    referrer: '',
    referrerPolicy: 'no-referrer',
    keepalive: false,
    integrity: '',
  });
}
