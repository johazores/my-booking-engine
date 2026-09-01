import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { IntegrationUnavailableError } from '@/server/integrations/integration-service.ts';
import { testStripeIntegrationConnection } from '@/server/integrations/stripe-integration.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const resultQuery: Record<string, string> = {
  HEALTHY: 'health-ok',
  AUTHENTICATION_FAILED: 'health-auth',
  RATE_LIMITED: 'health-rate-limit',
  PROVIDER_UNAVAILABLE: 'health-unavailable',
  INVALID_RESPONSE: 'health-invalid',
};

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });

  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/integrations?error=tenant', request.url), 303);

  try {
    const result = await testStripeIntegrationConnection({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
    });
    const query = resultQuery[result.status] ?? 'health-invalid';
    const parameter = result.status === 'HEALTHY' ? 'status' : 'error';
    return NextResponse.redirect(new URL(`/integrations?${parameter}=${query}`, request.url), 303);
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof IntegrationUnavailableError
        ? 'unavailable'
        : 'server';
    return NextResponse.redirect(new URL(`/integrations?error=${code}`, request.url), 303);
  }
}
