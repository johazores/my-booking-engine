import { readBoundedFormDataOrThrow } from '@/server/http/bounded-form-body.ts';

import { applyAuthResponseNoStore, isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession, redirectToLocalPath } from '@/server/auth/auth-http.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { findOrganizationForUser } from '@/server/organizations/organization-repository.ts';
import { ACTIVE_ORGANIZATION_COOKIE, activeOrganizationCookieOptions } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'organization.select' });
  let organizationId: string | undefined;
  const finish = (response: Response, failureOutcome?: RequestLogFailureOutcome) => observation.finish(
    applyAuthResponseNoStore(response),
    { organizationId },
    failureOutcome ? { failureOutcome } : undefined,
  );

  if (!isSameOriginAuthRequest(request)) return finish(new Response('Forbidden', { status: 403 }));
  if (!isSupportedAuthFormRequest(request)) return finish(new Response('Unsupported Media Type', { status: 415 }));

  let session: Awaited<ReturnType<typeof readAuthSession>>;
  try {
    session = await readAuthSession();
  } catch {
    return finish(new Response('Internal Server Error', { status: 500 }));
  }
  if (!session) return finish(redirectToLocalPath('/sign-in?error=required'), 'rejected');

  let formData: FormData;
  try {
    formData = await readBoundedFormDataOrThrow(request);
  } catch {
    return finish(redirectToLocalPath('/account?organizationError=selection'), 'rejected');
  }

  const requestedOrganizationId = formData.get('organizationId');
  if (typeof requestedOrganizationId !== 'string') {
    return finish(redirectToLocalPath('/account?organizationError=selection'), 'rejected');
  }

  try {
    const organization = await findOrganizationForUser({ organizationId: requestedOrganizationId, userId: session.user.id });
    if (!organization) return finish(new Response('Forbidden', { status: 403 }));
    organizationId = organization.id;

    const response = redirectToLocalPath('/account?status=organization-selected');
    response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, organization.id, activeOrganizationCookieOptions);
    return finish(response);
  } catch {
    return finish(new Response('Internal Server Error', { status: 500 }));
  }
}
