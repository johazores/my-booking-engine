import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  archiveIntegration,
  disableIntegration,
  enableIntegration,
  IntegrationLifecycleError,
  IntegrationUnavailableError,
} from '@/server/integrations/integration-service.ts';
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
    if (action !== 'enable' && action !== 'disable' && action !== 'archive') {
      return NextResponse.redirect(new URL('/integrations?error=validation', request.url), 303);
    }
    if (action === 'archive' && formData.get('confirm') !== 'archive') {
      return NextResponse.redirect(new URL('/integrations?error=archive-confirmation', request.url), 303);
    }
    const input = { organizationId: activeContext.organization.id, actorUserId: session.user.id, integrationId: params['integration-id'] };
    if (action === 'enable') await enableIntegration(input);
    else if (action === 'disable') await disableIntegration(input);
    else await archiveIntegration(input);
    return NextResponse.redirect(new URL(`/integrations?status=${action === 'enable' ? 'enabled' : action === 'disable' ? 'disabled' : 'archived'}`, request.url), 303);
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof IntegrationUnavailableError
        ? 'unavailable'
        : error instanceof IntegrationLifecycleError
          ? 'lifecycle'
          : error instanceof Error && /identifier|UUID/i.test(error.message)
            ? 'validation'
            : 'server';
    return NextResponse.redirect(new URL(`/integrations?error=${code}`, request.url), 303);
  }
}
