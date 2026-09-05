import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { findOrganizationForUser } from '@/server/organizations/organization-repository.ts';
import { ACTIVE_ORGANIZATION_COOKIE, activeOrganizationCookieOptions } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'organization.select' });
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
    return finish(NextResponse.redirect(new URL('/account?organizationError=selection', request.url), 303), 'rejected');
  }

  const requestedOrganizationId = formData.get('organizationId');
  if (typeof requestedOrganizationId !== 'string') {
    return finish(NextResponse.redirect(new URL('/account?organizationError=selection', request.url), 303), 'rejected');
  }

  try {
    const organization = await findOrganizationForUser({ organizationId: requestedOrganizationId, userId: session.user.id });
    if (!organization) return finish(new Response('Forbidden', { status: 403 }));
    organizationId = organization.id;

    const response = NextResponse.redirect(new URL('/account?status=organization-selected', request.url), 303);
    response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, organization.id, activeOrganizationCookieOptions);
    return finish(response);
  } catch {
    return finish(new Response('Internal Server Error', { status: 500 }));
  }
}
