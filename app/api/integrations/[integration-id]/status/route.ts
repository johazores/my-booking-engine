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
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request, context: { params: Promise<{ 'integration-id': string }> }) {
  const observation = createRequestObservation(request, { operation: 'integration.lifecycle.update' });
  let organizationId: string | undefined;
  const finish = (response: Response, failureOutcome?: RequestLogFailureOutcome) => observation.finish(
    response,
    { organizationId },
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
    const formData = await request.formData();
    const action = formData.get('action');
    const params = await context.params;
    if (action !== 'enable' && action !== 'disable' && action !== 'archive') {
      return finish(NextResponse.redirect(new URL('/integrations?error=validation', request.url), 303), 'rejected');
    }
    if (action === 'archive' && formData.get('confirm') !== 'archive') {
      return finish(NextResponse.redirect(new URL('/integrations?error=archive-confirmation', request.url), 303), 'rejected');
    }
    const input = { organizationId: activeContext.organization.id, actorUserId: session.user.id, integrationId: params['integration-id'] };
    if (action === 'enable') await enableIntegration(input);
    else if (action === 'disable') await disableIntegration(input);
    else await archiveIntegration(input);
    return finish(NextResponse.redirect(new URL(`/integrations?status=${action === 'enable' ? 'enabled' : action === 'disable' ? 'disabled' : 'archived'}`, request.url), 303));
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
    return finish(
      NextResponse.redirect(new URL(`/integrations?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
