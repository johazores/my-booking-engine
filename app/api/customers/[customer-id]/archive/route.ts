import { readBoundedFormDataOrThrow } from '@/server/http/bounded-form-body.ts';

import {
  applyAuthResponseNoStore,
  isSameOriginAuthRequest,
  isSupportedAuthFormRequest,
  readAuthSession,
  redirectToLocalPath,
} from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { CustomerValidationError } from '@/server/customers/customer-domain.ts';
import { CustomerUnavailableError, archiveCustomer } from '@/server/customers/customer-service.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'customer-id': string }> }) {
  const observation = createRequestObservation(request, { operation: 'customer.archive' });
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
    return finish(redirectToLocalPath('/customers?error=tenant'), 'rejected');
  }
  organizationId = activeContext.organization.id;

  const routeParams = await params;
  const customerId = routeParams['customer-id'];
  let formData: FormData;
  try {
    formData = await readBoundedFormDataOrThrow(request);
  } catch {
    return finish(
      redirectToLocalPath(`/customers/${encodeURIComponent(customerId)}?error=archive-confirmation`),
      'rejected',
    );
  }
  const confirmation = formData.get('confirmation');

  try {
    await archiveCustomer({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      customerId,
      confirmation: typeof confirmation === 'string' ? confirmation : '',
    });
    return finish(redirectToLocalPath('/customers?status=archived'));
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof CustomerValidationError
        ? 'archive-confirmation'
        : error instanceof CustomerUnavailableError
          ? 'unavailable'
          : 'server';
    return finish(
      redirectToLocalPath(`/customers/${encodeURIComponent(customerId)}?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
