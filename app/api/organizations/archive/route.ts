import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
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
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });

  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) {
    return NextResponse.redirect(new URL('/account?archiveError=tenant', request.url), 303);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.redirect(new URL('/account?archiveError=confirmation', request.url), 303);
  }

  try {
    await archiveOrganization({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      confirmation: field(formData, 'confirmation'),
    });

    const response = NextResponse.redirect(new URL('/account?status=organization-archived', request.url), 303);
    response.cookies.delete(ACTIVE_ORGANIZATION_COOKIE);
    return response;
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof OrganizationArchiveConfirmationError
        ? 'confirmation'
        : error instanceof OrganizationUnavailableError
          ? 'tenant'
          : 'server';
    return NextResponse.redirect(new URL(`/account?archiveError=${code}`, request.url), 303);
  }
}
