import { readBoundedFormDataOrThrow } from '@/server/http/bounded-form-body.ts';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession, redirectToLocalPath, applyAuthResponseNoStore } from '@/server/auth/auth-http.ts';
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

  let activeContext: Awaited<ReturnType<typeof readActiveOrganizationContext>>;
  try {
    activeContext = await readActiveOrganizationContext(session.user.id);
  } catch {
    return finish(new Response('Internal Server Error', { status: 500 }));
  }
  if (!activeContext.organization) {
    return finish(redirectToLocalPath('/account?settingsError=tenant'), 'rejected');
  }
  organizationId = activeContext.organization.id;

  let formData: FormData;
  try {
    formData = await readBoundedFormDataOrThrow(request);
  } catch {
    return finish(redirectToLocalPath('/account?settingsError=validation'), 'rejected');
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
    return finish(redirectToLocalPath('/account?status=organization-settings-updated'));
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
      redirectToLocalPath(`/account?settingsError=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
