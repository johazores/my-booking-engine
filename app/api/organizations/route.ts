import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { OrganizationValidationError } from '@/server/organizations/organization-domain.ts';
import { createOrganizationForUser, OrganizationSlugConflictError } from '@/server/organizations/organization-service.ts';
import { ACTIVE_ORGANIZATION_COOKIE, activeOrganizationCookieOptions } from '@/server/tenancy/tenant-context.ts';

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });

  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.redirect(new URL('/account?organizationError=validation', request.url), 303);
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
    const response = NextResponse.redirect(new URL('/account?status=organization-created', request.url), 303);
    response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, organization.id, activeOrganizationCookieOptions);
    return response;
  } catch (error) {
    const code = error instanceof OrganizationSlugConflictError ? 'slug' : error instanceof OrganizationValidationError ? 'validation' : 'server';
    return NextResponse.redirect(new URL(`/account?organizationError=${code}`, request.url), 303);
  }
}
