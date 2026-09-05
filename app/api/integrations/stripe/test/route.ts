import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { IntegrationUnavailableError } from '@/server/integrations/integration-service.ts';
import { testStripeIntegrationConnection } from '@/server/integrations/stripe-integration.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const resultQuery: Record<string, string> = {
  HEALTHY: 'health-ok',
  AUTHENTICATION_FAILED: 'health-auth',
  RATE_LIMITED: 'health-rate-limit',
  PROVIDER_UNAVAILABLE: 'health-unavailable',
  INVALID_RESPONSE: 'health-invalid',
};

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'integration.stripe.connection-test' });
  let organizationId: string | undefined;
  const finish = (response: Response, failureOutcome?: RequestLogFailureOutcome) => observation.finish(
    response,
    { organizationId, provider: 'stripe' },
    failureOutcome ? { failureOutcome } : undefined,
  );

  if (!isSameOriginAuthRequest(request)) return finish(new Response('Forbidden', { status: 403 }));
  if (!isSupportedAuthFormRequest(request)) return finish(new Response('Unsupported Media Type', { status: 415 }));

  const session = await readAuthSession();
  if (!session) return finish(NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303), 'rejected');
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return finish(NextResponse.redirect(new URL('/integrations?error=tenant', request.url), 303), 'rejected');
  organizationId = activeContext.organization.id;

  try {
    const result = await testStripeIntegrationConnection({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
    });
    const query = resultQuery[result.status] ?? 'health-invalid';
    const parameter = result.status === 'HEALTHY' ? 'status' : 'error';
    return finish(
      NextResponse.redirect(new URL(`/integrations?${parameter}=${query}`, request.url), 303),
      result.status === 'HEALTHY' ? undefined : 'rejected',
    );
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof IntegrationUnavailableError
        ? 'unavailable'
        : 'server';
    return finish(
      NextResponse.redirect(new URL(`/integrations?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
