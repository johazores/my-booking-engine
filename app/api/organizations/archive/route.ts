import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import {
  OrganizationArchiveConfirmationError,
  OrganizationUnavailableError,
  archiveOrganization,
} from '@/server/organizations/organization-management-service.ts';
import {
  ACTIVE_ORGANIZATION_COOKIE,
  readActiveOrganizationContext,
} from '@/server/tenancy/tenant-context.ts';

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'organization.archive' });
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

  let activeContext: Awaited<ReturnType<typeof readActiveOrganizationContext>>;
  try {
    activeContext = await readActiveOrganizationContext(session.user.id);
  } catch {
    return finish(new Response('Internal Server Error', { status: 500 }));
  }
  if (!activeContext.organization) {
    return finish(NextResponse.redirect(new URL('/account?archiveError=tenant', request.url), 303), 'rejected');
  }
  organizationId = activeContext.organization.id;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return finish(NextResponse.redirect(new URL('/account?archiveError=confirmation', request.url), 303), 'rejected');
  }

  try {
    await archiveOrganization({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      confirmation: field(formData, 'confirmation'),
    });

    const response = NextResponse.redirect(new URL('/account?status=organization-archived', request.url), 303);
    response.cookies.delete(ACTIVE_ORGANIZATION_COOKIE);
    return finish(response);
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof OrganizationArchiveConfirmationError
        ? 'confirmation'
        : error instanceof OrganizationUnavailableError
          ? 'tenant'
          : 'server';
    return finish(
      NextResponse.redirect(new URL(`/account?archiveError=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
