import { FormBodyValidationError, readBoundedFormDataOrThrow } from '@/server/http/bounded-form-body.ts';

import {
  applyAuthResponseNoStore,
  isSameOriginAuthRequest,
  isSupportedAuthFormRequest,
  readAuthSession,
  redirectToLocalPath,
} from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { saveIntegration } from '@/server/integrations/integration-service.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { normalizeTravelportStaysConfiguration, TravelportStaysConfigurationError } from '@/server/suppliers/travelport-stays-provider.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'integration.travelport-stays.configure' });
  let organizationId: string | undefined;
  const finish = (response: Response, failureOutcome?: RequestLogFailureOutcome) => observation.finish(
    applyAuthResponseNoStore(response),
    { organizationId, provider: 'travelport-stays' },
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
    const configuration = normalizeTravelportStaysConfiguration({
      environment: field(formData, 'environment'),
      username: field(formData, 'username'),
      password: field(formData, 'password'),
      clientId: field(formData, 'clientId'),
      clientSecret: field(formData, 'clientSecret'),
      accessGroup: field(formData, 'accessGroup'),
    });
    await saveIntegration({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      providerCode: 'travelport-stays',
      displayName: 'Travelport Stays',
      capabilities: configuration.capabilities,
      credentials: configuration.credentials,
    });
    return finish(redirectToLocalPath('/integrations?status=travelport-saved'));
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof FormBodyValidationError
        ? 'validation'
        : error instanceof TravelportStaysConfigurationError
          ? 'travelport-validation'
        : 'server';
    return finish(
      redirectToLocalPath(`/integrations?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
