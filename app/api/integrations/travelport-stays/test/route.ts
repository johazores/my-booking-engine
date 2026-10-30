
import {
  applyAuthResponseNoStore,
  isSameOriginAuthRequest,
  isSupportedAuthFormRequest,
  readAuthSession,
  redirectToLocalPath,
} from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { IntegrationUnavailableError } from '@/server/integrations/integration-service.ts';
import { testTravelportStaysIntegrationConnection } from '@/server/integrations/travelport-stays-integration.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const resultQuery: Record<string, string> = {
  HEALTHY: 'travelport-health-ok',
  AUTHENTICATION_FAILED: 'travelport-health-auth',
  RATE_LIMITED: 'travelport-health-rate-limit',
  PROVIDER_UNAVAILABLE: 'travelport-health-unavailable',
  INVALID_RESPONSE: 'travelport-health-invalid',
};

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'integration.travelport-stays.connection-test' });
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
    const result = await testTravelportStaysIntegrationConnection({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
    });
    const query = resultQuery[result.status] ?? 'travelport-health-invalid';
    const parameter = result.status === 'HEALTHY' ? 'status' : 'error';
    return finish(
      redirectToLocalPath(`/integrations?${parameter}=${query}`),
      result.status === 'HEALTHY' ? undefined : 'rejected',
    );
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof IntegrationUnavailableError
        ? 'unavailable'
        : 'server';
    return finish(
      redirectToLocalPath(`/integrations?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
