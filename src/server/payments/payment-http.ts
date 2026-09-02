import { isSameOriginAuthRequest, readAuthSession } from '../auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '../authorization/authorization-service.ts';
import { readActiveOrganizationContext } from '../tenancy/tenant-context.ts';
import { PaymentProviderError } from './payment-provider.ts';
import { PaymentConflictError, PaymentUnavailableError } from './payment-service.ts';
import { isInternalPaymentClaimReference } from './stripe-payment-service.ts';

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
  if (!session) return { response: Response.json({ error: 'authentication-required' }, { status: 401 }) } as const;

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return { response: Response.json({ error: 'organization-required' }, { status: 409 }) } as const;

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
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function paymentApiError(error: unknown) {
  if (error instanceof PaymentApiRequestError) return Response.json({ error: 'invalid-request', message: error.message }, { status: 403 });
  if (error instanceof OrganizationPermissionDeniedError) return Response.json({ error: 'forbidden' }, { status: 403 });
  if (error instanceof PaymentConflictError) return Response.json({ error: 'conflict', message: error.message }, { status: 409 });
  if (error instanceof PaymentUnavailableError) return Response.json({ error: 'unavailable', message: error.message }, { status: 404 });
  if (error instanceof PaymentProviderError) {
    return Response.json({
      error: 'provider-error',
      code: error.code,
      retryable: error.retryable,
      message: error.message,
    }, { status: error.retryable ? 503 : 502 });
  }
  if (error instanceof SyntaxError) return Response.json({ error: 'invalid-json' }, { status: 400 });
  if (error instanceof Error && /must|required|invalid|cannot|between|at least|at most|only|does not accept|zero-value/i.test(error.message)) {
    return Response.json({ error: 'validation', message: error.message }, { status: 400 });
  }
  return Response.json({ error: 'internal-error' }, { status: 500 });
}
