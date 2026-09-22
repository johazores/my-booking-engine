import { PaymentProviderError } from './payment-provider.ts';

const STRIPE_API_ORIGIN = 'https://api.stripe.com';
const STRIPE_PAYMENT_INTENT_PATH = /^\/v1\/payment_intents\/pi_[A-Za-z0-9_]+$/;
const STRIPE_PAYMENT_INTENT_MUTATION_PATH = /^\/v1\/payment_intents\/pi_[A-Za-z0-9_]+\/(?:capture|cancel)$/;
const STRIPE_REFUND_PATH = /^\/v1\/refunds\/re_[A-Za-z0-9_]+$/;
const STRIPE_CHECKOUT_SESSION_PATH = /^\/v1\/checkout\/sessions\/cs_[A-Za-z0-9_]+$/;
const STRIPE_GET_HEADERS = new Set(['authorization']);
const STRIPE_POST_HEADERS = new Set(['authorization', 'content-type', 'idempotency-key']);

export type StripeApiFetch = typeof fetch;

function invalidTransportRequest(): never {
  throw new PaymentProviderError('INVALID_REQUEST', 'Stripe API transport request is outside the reviewed SF provider boundary.');
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
  if (typeof init.body !== 'string' || init.body.length === 0) invalidTransportRequest();
  return headers;
}

/**
 * Final server-side transport boundary for the Stripe REST calls SF currently implements.
 * It deliberately projects only reviewed Fetch fields so caller/framework metadata cannot
 * become routing, credential, redirect, caching, referrer, or connection authority.
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

  return fetchImpl(url.toString(), {
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
  });
}
