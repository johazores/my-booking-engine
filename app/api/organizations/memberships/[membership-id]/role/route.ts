import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { MembershipRoleConflictError, MembershipRoleValidationError, updateMembershipRole } from '@/server/memberships/membership-role-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function POST(
  request: Request,
  context: { params: Promise<{ 'membership-id': string }> },
) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });

  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/account?roleError=tenant', request.url), 303);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.redirect(new URL('/account?roleError=validation', request.url), 303);
  }

  try {
    const membershipId = (await context.params)['membership-id'];
    await updateMembershipRole({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      membershipId,
      role: field(formData, 'role'),
    });
    return NextResponse.redirect(new URL('/account?status=role-updated', request.url), 303);
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof MembershipRoleConflictError
        ? 'last-admin'
        : error instanceof MembershipRoleValidationError
          ? 'validation'
          : 'server';
    return NextResponse.redirect(new URL(`/account?roleError=${code}`, request.url), 303);
  }
}
