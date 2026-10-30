import { readBoundedFormDataOrThrow } from '@/server/http/bounded-form-body.ts';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession, redirectToLocalPath } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { MembershipRoleConflictError, MembershipRoleValidationError, updateMembershipRole } from '@/server/memberships/membership-role-service.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function POST(
  request: Request,
  context: { params: Promise<{ 'membership-id': string }> },
) {
  const observation = createRequestObservation(request, { operation: 'organization.membership.role.update' });
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
  if (!activeContext.organization) return finish(redirectToLocalPath('/account?roleError=tenant'), 'rejected');
  organizationId = activeContext.organization.id;

  let formData: FormData;
  try {
    formData = await readBoundedFormDataOrThrow(request);
  } catch {
    return finish(redirectToLocalPath('/account?roleError=validation'), 'rejected');
  }

  try {
    const membershipId = (await context.params)['membership-id'];
    await updateMembershipRole({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      membershipId,
      role: field(formData, 'role'),
    });
    return finish(redirectToLocalPath('/account?status=role-updated'));
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof MembershipRoleConflictError
        ? 'last-admin'
        : error instanceof MembershipRoleValidationError
          ? 'validation'
          : 'server';
    return finish(
      redirectToLocalPath(`/account?roleError=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
