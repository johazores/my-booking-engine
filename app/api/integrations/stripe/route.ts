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
import { normalizeStripeIntegrationConfiguration, StripeIntegrationConfigurationError } from '@/server/integrations/stripe-integration.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'integration.stripe.configure' });
  let organizationId: string | undefined;
  const finish = (response: Response, failureOutcome?: RequestLogFailureOutcome) => observation.finish(
    applyAuthResponseNoStore(response),
    { organizationId, provider: 'stripe' },
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
    const configuration = normalizeStripeIntegrationConfiguration({
      secretKey: field(formData, 'secretKey'),
      webhookSecret: field(formData, 'webhookSecret'),
    });
    await saveIntegration({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      providerCode: 'stripe',
      displayName: 'Stripe',
      capabilities: configuration.capabilities,
      credentials: configuration.credentials,
    });
    return finish(redirectToLocalPath('/integrations?status=saved'));
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof StripeIntegrationConfigurationError || error instanceof FormBodyValidationError
        ? 'validation'
        : 'server';
    return finish(
      redirectToLocalPath(`/integrations?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
