import { FormBodyValidationError, readBoundedFormDataOrThrow } from '@/server/http/bounded-form-body.ts';

import {
  applyAuthResponseNoStore,
  isSameOriginAuthRequest,
  isSupportedAuthFormRequest,
  readAuthSession,
  redirectToLocalPath,
} from '@/server/auth/auth-http.ts';
import { TenantIdentifierValidationError } from '@/server/tenancy/tenant-scope.ts';
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
    applyAuthResponseNoStore(response),
    { organizationId },
    failureOutcome ? { failureOutcome } : undefined,
  );

  if (!isSameOriginAuthRequest(request)) return finish(new Response('Forbidden', { status: 403 }));
  if (!isSupportedAuthFormRequest(request)) return finish(new Response('Unsupported Media Type', { status: 415 }));

  const session = await readAuthSession();
  if (!session) return finish(redirectToLocalPath('/sign-in?error=required'), 'rejected');
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return finish(redirectToLocalPath('/integrations?error=tenant'), 'rejected');
  organizationId = activeContext.organization.id;

  try {
    const formData = await readBoundedFormDataOrThrow(request);
    const action = formData.get('action');
    const params = await context.params;
    if (action !== 'enable' && action !== 'disable' && action !== 'archive') {
      return finish(redirectToLocalPath('/integrations?error=validation'), 'rejected');
    }
    if (action === 'archive' && formData.get('confirm') !== 'archive') {
      return finish(redirectToLocalPath('/integrations?error=archive-confirmation'), 'rejected');
    }
    const input = { organizationId: activeContext.organization.id, actorUserId: session.user.id, integrationId: params['integration-id'] };
    if (action === 'enable') await enableIntegration(input);
    else if (action === 'disable') await disableIntegration(input);
    else await archiveIntegration(input);
    return finish(redirectToLocalPath(`/integrations?status=${action === 'enable' ? 'enabled' : action === 'disable' ? 'disabled' : 'archived'}`));
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof IntegrationUnavailableError
        ? 'unavailable'
        : error instanceof IntegrationLifecycleError
          ? 'lifecycle'
          : error instanceof TenantIdentifierValidationError || error instanceof FormBodyValidationError
            ? 'validation'
            : 'server';
    return finish(
      redirectToLocalPath(`/integrations?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
