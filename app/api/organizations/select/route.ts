import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { findOrganizationForUser } from '@/server/organizations/organization-repository.ts';
import { ACTIVE_ORGANIZATION_COOKIE, activeOrganizationCookieOptions } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });

  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.redirect(new URL('/account?organizationError=selection', request.url), 303);
  }

  const organizationId = formData.get('organizationId');
  if (typeof organizationId !== 'string') {
    return NextResponse.redirect(new URL('/account?organizationError=selection', request.url), 303);
  }

  try {
    const organization = await findOrganizationForUser({ organizationId, userId: session.user.id });
    if (!organization) return new Response('Forbidden', { status: 403 });

    const response = NextResponse.redirect(new URL('/account?status=organization-selected', request.url), 303);
    response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, organization.id, activeOrganizationCookieOptions);
    return response;
  } catch {
    return new Response('Forbidden', { status: 403 });
  }
}
