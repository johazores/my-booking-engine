import { readBoundedFormDataOrThrow } from '@/server/http/bounded-form-body.ts';

import {
  applyAuthResponseNoStore,
  isSameOriginAuthRequest,
  isSupportedAuthFormRequest,
  readAuthSession,
  redirectToLocalPath,
} from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  CustomerConflictError,
  createCustomer,
} from '@/server/customers/customer-service.ts';
import { CustomerValidationError } from '@/server/customers/customer-domain.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'customer.create' });
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

  let formData: FormData;
  try {
    formData = await readBoundedFormDataOrThrow(request);
  } catch {
    return finish(redirectToLocalPath('/customers?error=validation'), 'rejected');
  }

  try {
    const customer = await createCustomer({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      customer: {
        firstName: field(formData, 'firstName'),
        lastName: field(formData, 'lastName'),
        email: field(formData, 'email'),
        phone: field(formData, 'phone'),
        notes: field(formData, 'notes'),
      },
    });
    return finish(redirectToLocalPath(`/customers/${customer.id}?status=created`));
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof CustomerConflictError
        ? 'email'
        : error instanceof CustomerValidationError
          ? 'validation'
          : 'server';
    return finish(
      redirectToLocalPath(`/customers?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
