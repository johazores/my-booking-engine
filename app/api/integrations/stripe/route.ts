import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
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
    const formData = await request.formData();
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
    return finish(NextResponse.redirect(new URL('/integrations?status=saved', request.url), 303));
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof StripeIntegrationConfigurationError
        ? 'validation'
        : 'server';
    return finish(
      NextResponse.redirect(new URL(`/integrations?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
