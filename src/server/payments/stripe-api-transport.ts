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

function reviewedHeaders(headersInput: RequestInit['headers'], method: 'GET' | 'POST', body: RequestInit['body']): Headers {
  let headers: Headers;
  try {
    headers = new Headers(headersInput);
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
    if (body !== undefined && body !== null) invalidTransportRequest();
    return headers;
  }

  if (headers.get('content-type') !== 'application/x-www-form-urlencoded') invalidTransportRequest();
  const idempotencyKey = headers.get('idempotency-key');
  if (!idempotencyKey || idempotencyKey.length > 255 || !/^[\x21-\x7e]+$/.test(idempotencyKey)) {
    invalidTransportRequest();
  }
  if (
    typeof body !== 'string'
    || body.length === 0
    || !hasUtf8ByteLengthAtMost(body, MAX_STRIPE_API_REQUEST_BYTES)
  ) {
    invalidTransportRequest();
  }
  return headers;
}

/**
 * Reject forged signals without trusting a caller-overridden `aborted` getter.
 * An already-aborted native signal preserves caller-owned timeout authority.
 */
function nativeStripeSignalAborted(signal: AbortSignal): boolean {
  // Native state, not a caller-shadowed `aborted` property.
  return Reflect.get(AbortSignal.prototype, 'aborted', signal) as boolean;
}

function reviewedStripeSignal(signal: RequestInit['signal']): AbortSignal | undefined {
  if (signal == null) return undefined;
  let aborted: boolean;
  try {
    aborted = nativeStripeSignalAborted(signal);
  } catch {
    invalidTransportRequest();
  }
  if (aborted) throw abortResponseRead();
  return signal;
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
  if (nativeStripeSignalAborted(signal)) throw abortResponseRead();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = <T>(callback: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      AbortSignal.prototype.removeEventListener.call(signal, 'abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      AbortSignal.prototype.removeEventListener.call(signal, 'abort', onAbort);
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        // Stream cancellation is best-effort and cannot override abort authority.
      }
      reject(abortResponseRead());
    };

    AbortSignal.prototype.addEventListener.call(signal, 'abort', onAbort, { once: true });
    // Close the gap between the first native-state check and listener registration.
    if (nativeStripeSignalAborted(signal)) {
      onAbort();
      return;
    }
    try {
      reader.read().then(
        (result) => finish(resolve, result),
        (error: unknown) => finish(reject, error),
      );
    } catch (error) {
      finish(reject, error);
    }
  });
}

function cancelStripeResponseBody(response: Response): void {
  try {
    const body = response.body;
    if (body !== null) void body.cancel().catch(() => undefined);
  } catch {
    // A malformed response or failed cancellation must not replace provider
    // evidence or an already-expired caller-owned deadline.
  }
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
  // The caller's actual timeout takes precedence over malformed provider
  // metadata, including when Fetch resolves after the deadline.
  if (signal && nativeStripeSignalAborted(signal)) {
    cancelStripeResponseBody(response);
    throw abortResponseRead();
  }
  let responseBody: ReadableStream<Uint8Array> | null;
  try {
    assertStripeDeclaredResponseLength(response);
    responseBody = response.body;
  } catch (error) {
    cancelStripeResponseBody(response);
    if (signal && nativeStripeSignalAborted(signal)) throw abortResponseRead();
    if (error instanceof PaymentProviderError) throw error;
    invalidTransportResponse();
  }
  if (responseBody === null) return response;

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = responseBody.getReader();
  } catch {
    cancelStripeResponseBody(response);
    if (signal && nativeStripeSignalAborted(signal)) throw abortResponseRead();
    invalidTransportResponse();
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await readStripeResponseChunk(reader, signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) invalidTransportResponse();
      totalBytes += value.byteLength;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_STRIPE_API_RESPONSE_BYTES) {
        invalidTransportResponse();
      }
      chunks.push(value.slice());
    }
  } catch (error) {
    // Malformed provider chunks, exceeded limits, and rejected reads must not
    // leave a provider stream active. Preserve caller-owned abort precedence
    // and never let best-effort cancellation replace the original failure.
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      // Cancellation is best-effort after a response acquisition failure.
    }
    if (signal && nativeStripeSignalAborted(signal)) throw abortResponseRead();
    if (error instanceof PaymentProviderError) throw error;
    invalidTransportResponse();
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (signal && nativeStripeSignalAborted(signal)) throw abortResponseRead();
  try {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    const replay = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    if (signal && nativeStripeSignalAborted(signal)) throw abortResponseRead();
    return replay;
  } catch (error) {
    if (signal && nativeStripeSignalAborted(signal)) throw abortResponseRead();
    if (error instanceof PaymentProviderError) throw error;
    invalidTransportResponse();
  }
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
  // Materialize caller-owned metadata once. A getter must not validate one
  // payment body or signal and supply a different value to Fetch later.
  let method: RequestInit['method'];
  let body: RequestInit['body'];
  let signal: RequestInit['signal'];
  let headersInput: RequestInit['headers'];
  try {
    method = init.method;
    body = init.body;
    signal = init.signal;
    headersInput = init.headers;
  } catch {
    invalidTransportRequest();
  }
  if ((method !== 'GET' && method !== 'POST') || !reviewedStripeOperation(method, url.pathname)) {
    invalidTransportRequest();
  }
  const readySignal = reviewedStripeSignal(signal);
  const headers = reviewedHeaders(headersInput, method, body);

  return fetchStripeApiResponse(fetchImpl, url.toString(), {
    method,
    headers,
    ...(method === 'POST' ? { body: body as string } : {}),
    signal: readySignal,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'manual',
    referrer: '',
    referrerPolicy: 'no-referrer',
    keepalive: false,
    integrity: '',
  });
}
