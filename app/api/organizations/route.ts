import { readBoundedFormDataOrThrow } from '@/server/http/bounded-form-body.ts';

import { applyAuthResponseNoStore, isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession, redirectToLocalPath } from '@/server/auth/auth-http.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { OrganizationValidationError } from '@/server/organizations/organization-domain.ts';
import { createOrganizationForUser, OrganizationSlugConflictError } from '@/server/organizations/organization-service.ts';
import { ACTIVE_ORGANIZATION_COOKIE, activeOrganizationCookieOptions } from '@/server/tenancy/tenant-context.ts';

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'organization.create' });
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
    return finish(redirectToLocalPath('/account?organizationError=validation'), 'rejected');
  }

  try {
    const organization = await createOrganizationForUser({
      userId: session.user.id,
      name: field(formData, 'name'),
      slug: field(formData, 'slug') || undefined,
      kind: field(formData, 'kind'),
      timezone: field(formData, 'timezone'),
      currency: field(formData, 'currency'),
    });
    organizationId = organization.id;
    const response = redirectToLocalPath('/account?status=organization-created');
    response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, organization.id, activeOrganizationCookieOptions);
    return finish(response);
  } catch (error) {
    const code = error instanceof OrganizationSlugConflictError ? 'slug' : error instanceof OrganizationValidationError ? 'validation' : 'server';
    return finish(
      redirectToLocalPath(`/account?organizationError=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
