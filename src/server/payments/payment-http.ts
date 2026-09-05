import { isSameOriginAuthRequest, readAuthSession } from '../auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '../authorization/authorization-service.ts';
import { readActiveOrganizationContext } from '../tenancy/tenant-context.ts';
import { paymentProviderClientError } from './payment-provider-client-error.ts';
import { PaymentProviderError } from './payment-provider.ts';
import { PaymentConflictError, PaymentUnavailableError } from './payment-service.ts';
import { isInternalPaymentClaimReference } from './stripe-payment-service.ts';

const PAYMENT_NO_STORE_HEADERS = Object.freeze({ 'cache-control': 'no-store' });

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
  if (error instanceof OrganizationPermissionDeniedError) return paymentErrorJson({ error: 'forbidden' }, 403);
  if (error instanceof PaymentConflictError) return paymentErrorJson({ error: 'conflict', message: error.message }, 409);
  if (error instanceof PaymentUnavailableError) return paymentErrorJson({ error: 'unavailable', message: error.message }, 404);
  if (error instanceof PaymentProviderError) {
    return paymentErrorJson({
      error: 'provider-error',
      ...paymentProviderClientError(error),
    }, error.retryable ? 503 : 502);
  }
  if (error instanceof SyntaxError) return paymentErrorJson({ error: 'invalid-json' }, 400);
  if (error instanceof Error && /must|required|invalid|cannot|between|at least|at most|only|does not accept|zero-value/i.test(error.message)) {
    return paymentErrorJson({ error: 'validation', message: error.message }, 400);
  }
  return paymentErrorJson({ error: 'internal-error' }, 500);
}
