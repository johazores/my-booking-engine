import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { OrganizationValidationError } from '@/server/organizations/organization-domain.ts';
import {
  OrganizationSettingsConflictError,
  OrganizationSettingsDependencyError,
  OrganizationUnavailableError,
  updateOrganizationSettings,
} from '@/server/organizations/organization-management-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

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
    return NextResponse.redirect(new URL('/account?settingsError=tenant', request.url), 303);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.redirect(new URL('/account?settingsError=validation', request.url), 303);
  }

  try {
    await updateOrganizationSettings({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      name: field(formData, 'name'),
      slug: field(formData, 'slug'),
      kind: field(formData, 'kind'),
      timezone: field(formData, 'timezone'),
      currency: field(formData, 'currency'),
    });
    return NextResponse.redirect(new URL('/account?status=organization-settings-updated', request.url), 303);
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof OrganizationSettingsConflictError
        ? 'slug'
        : error instanceof OrganizationSettingsDependencyError
          ? 'validation'
          : error instanceof OrganizationValidationError
            ? 'validation'
            : error instanceof OrganizationUnavailableError
              ? 'tenant'
              : 'server';
    return NextResponse.redirect(new URL(`/account?settingsError=${code}`, request.url), 303);
  }
}
