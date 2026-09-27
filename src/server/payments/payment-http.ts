import { isSameOriginAuthRequest, readAuthSession } from '../auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '../authorization/authorization-service.ts';
import { readActiveOrganizationContext } from '../tenancy/tenant-context.ts';
import { paymentProviderClientErrorFromThrown } from './payment-provider-client-error.ts';
import { PaymentConflictError, PaymentUnavailableError } from './payment-service.ts';
import { isInternalPaymentClaimReference } from './stripe-payment-service.ts';

const PAYMENT_NO_STORE_HEADERS = Object.freeze({ 'cache-control': 'no-store' });

export const PAYMENT_REQUEST_MAX_BYTES = 64 * 1024;

export class PaymentApiPayloadError extends Error {
  constructor() {
    super('Request body must be a bounded JSON object.');
    this.name = 'PaymentApiPayloadError';
  }
}

function hasJsonContentType(request: Request) {
  const contentType = request.headers.get('content-type');
  if (!contentType) return false;
  return contentType.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function hasAcceptableContentLength(request: Request, maxBytes: number) {
  const header = request.headers.get('content-length');
  if (header === null) return true;
  if (!/^[0-9]+$/.test(header)) return false;
  const contentLength = Number(header);
  return Number.isSafeInteger(contentLength) && contentLength <= maxBytes;
}

async function readBoundedRequestText(request: Request, maxBytes: number) {
  if (!request.body) throw new PaymentApiPayloadError();
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let receivedBytes = 0;
  let text = '';

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw new PaymentApiPayloadError();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be errored or closed.
    }
    if (error instanceof PaymentApiPayloadError) throw error;
    throw new PaymentApiPayloadError();
  } finally {
    reader.releaseLock();
  }
}

export async function readPaymentJsonObject(
  request: Request,
  maxBytes = PAYMENT_REQUEST_MAX_BYTES,
): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new PaymentApiPayloadError();
  if (!hasJsonContentType(request) || !hasAcceptableContentLength(request, maxBytes)) {
    throw new PaymentApiPayloadError();
  }

  const rawBody = await readBoundedRequestText(request, maxBytes);
  try {
    const body: unknown = JSON.parse(rawBody);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PaymentApiPayloadError();
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof PaymentApiPayloadError) throw error;
    throw new PaymentApiPayloadError();
  }
}

export class PaymentApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentApiRequestError';
  }
}

export async function requirePaymentApiContext(request: Request, options?: { write?: boolean }) {
  if (options?.write && !isSameOriginAuthRequest(request)) {
    throw new PaymentApiRequestError('Request origin is not allowed.');
  }

  const session = await readAuthSession();
  if (!session) return { response: Response.json({ error: 'authentication-required' }, { status: 401, headers: PAYMENT_NO_STORE_HEADERS }) } as const;

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) {
    return { response: Response.json({ error: 'organization-required' }, { status: 409, headers: PAYMENT_NO_STORE_HEADERS }) } as const;
  }

  return {
    response: null,
    organizationId: activeContext.organization.id,
    actorUserId: session.user.id,
  } as const;
}

export function paymentJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value, (key, item) => {
    if (key === 'providerReference' && isInternalPaymentClaimReference(item)) return null;
    if (typeof item === 'bigint') return item.toString();
    if (item instanceof Date) return item.toISOString();
    return item;
  }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...PAYMENT_NO_STORE_HEADERS },
  });
}

function paymentErrorJson(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: PAYMENT_NO_STORE_HEADERS });
}

export function paymentApiError(error: unknown) {
  if (error instanceof PaymentApiRequestError) return paymentErrorJson({ error: 'invalid-request', message: error.message }, 403);
  if (error instanceof PaymentApiPayloadError) return paymentErrorJson({ error: 'invalid-request' }, 400);
  if (error instanceof OrganizationPermissionDeniedError) return paymentErrorJson({ error: 'forbidden' }, 403);
  if (error instanceof PaymentConflictError) return paymentErrorJson({ error: 'conflict', message: error.message }, 409);
  if (error instanceof PaymentUnavailableError) return paymentErrorJson({ error: 'unavailable', message: error.message }, 404);

  const providerError = paymentProviderClientErrorFromThrown(error);
  if (providerError) {
    return paymentErrorJson({
      error: 'provider-error',
      ...providerError,
    }, providerError.retryable ? 503 : 502);
  }

  if (error instanceof SyntaxError) return paymentErrorJson({ error: 'invalid-json' }, 400);
  if (error instanceof Error && /must|required|invalid|cannot|between|at least|at most|only|does not accept|zero-value/i.test(error.message)) {
    return paymentErrorJson({ error: 'validation', message: error.message }, 400);
  }
  return paymentErrorJson({ error: 'internal-error' }, 500);
}
