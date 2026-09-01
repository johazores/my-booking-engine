import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { disableIntegration, enableIntegration, IntegrationUnavailableError } from '@/server/integrations/integration-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request, context: { params: Promise<{ 'integration-id': string }> }) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });

  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/integrations?error=tenant', request.url), 303);

  try {
    const formData = await request.formData();
    const action = formData.get('action');
    const params = await context.params;
    if (action !== 'enable' && action !== 'disable') {
      return NextResponse.redirect(new URL('/integrations?error=validation', request.url), 303);
    }
    const input = { organizationId: activeContext.organization.id, actorUserId: session.user.id, integrationId: params['integration-id'] };
    if (action === 'enable') await enableIntegration(input);
    else await disableIntegration(input);
    return NextResponse.redirect(new URL(`/integrations?status=${action === 'enable' ? 'enabled' : 'disabled'}`, request.url), 303);
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError ? 'permission' : error instanceof IntegrationUnavailableError ? 'unavailable' : error instanceof Error && /identifier|UUID/i.test(error.message) ? 'validation' : 'server';
    return NextResponse.redirect(new URL(`/integrations?error=${code}`, request.url), 303);
  }
}
