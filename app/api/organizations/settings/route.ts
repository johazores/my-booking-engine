import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
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
  const observation = createRequestObservation(request, { operation: 'organization.settings.update' });
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
    return finish(NextResponse.redirect(new URL('/account?settingsError=tenant', request.url), 303), 'rejected');
  }
  organizationId = activeContext.organization.id;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return finish(NextResponse.redirect(new URL('/account?settingsError=validation', request.url), 303), 'rejected');
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
    return finish(NextResponse.redirect(new URL('/account?status=organization-settings-updated', request.url), 303));
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
    return finish(
      NextResponse.redirect(new URL(`/account?settingsError=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
