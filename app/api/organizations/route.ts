import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
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
    response,
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
  if (!session) return finish(NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303), 'rejected');

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return finish(NextResponse.redirect(new URL('/account?organizationError=validation', request.url), 303), 'rejected');
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
    const response = NextResponse.redirect(new URL('/account?status=organization-created', request.url), 303);
    response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, organization.id, activeOrganizationCookieOptions);
    return finish(response);
  } catch (error) {
    const code = error instanceof OrganizationSlugConflictError ? 'slug' : error instanceof OrganizationValidationError ? 'validation' : 'server';
    return finish(
      NextResponse.redirect(new URL(`/account?organizationError=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
