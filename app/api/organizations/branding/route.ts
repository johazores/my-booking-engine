import { readBoundedFormDataOrThrow } from '@/server/http/bounded-form-body.ts';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession, redirectToLocalPath } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  BrandingConflictError,
  BrandingUnavailableError,
  updateOrganizationBranding,
} from '@/server/branding/branding-service.ts';
import { BrandingValidationError } from '@/server/branding/branding-domain.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'organization.branding.update' });
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
  if (!session) return finish(redirectToLocalPath('/sign-in?error=required'), 'rejected');

  let activeContext: Awaited<ReturnType<typeof readActiveOrganizationContext>>;
  try {
    activeContext = await readActiveOrganizationContext(session.user.id);
  } catch {
    return finish(new Response('Internal Server Error', { status: 500 }));
  }
  if (!activeContext.organization) {
    return finish(redirectToLocalPath('/branding?error=tenant'), 'rejected');
  }
  organizationId = activeContext.organization.id;

  let formData: FormData;
  try {
    formData = await readBoundedFormDataOrThrow(request);
  } catch {
    return finish(redirectToLocalPath('/branding?error=validation'), 'rejected');
  }

  try {
    await updateOrganizationBranding({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      branding: {
        logoUrl: field(formData, 'logoUrl'),
        faviconUrl: field(formData, 'faviconUrl'),
        primaryColor: field(formData, 'primaryColor'),
        secondaryColor: field(formData, 'secondaryColor'),
        accentColor: field(formData, 'accentColor'),
        fontFamily: field(formData, 'fontFamily'),
        contactEmail: field(formData, 'contactEmail'),
        contactPhone: field(formData, 'contactPhone'),
        websiteUrl: field(formData, 'websiteUrl'),
        emailFromName: field(formData, 'emailFromName'),
        emailReplyTo: field(formData, 'emailReplyTo'),
        publicBookingTitle: field(formData, 'publicBookingTitle'),
        publicBookingDescription: field(formData, 'publicBookingDescription'),
        customDomain: field(formData, 'customDomain'),
      },
    });
    return finish(redirectToLocalPath('/branding?status=updated'));
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof BrandingConflictError
        ? 'domain'
        : error instanceof BrandingValidationError
          ? 'validation'
          : error instanceof BrandingUnavailableError
            ? 'tenant'
            : 'server';
    return finish(
      redirectToLocalPath(`/branding?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
