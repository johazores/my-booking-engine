import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { CustomerValidationError } from '@/server/customers/customer-domain.ts';
import { CustomerUnavailableError, archiveCustomer } from '@/server/customers/customer-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'customer-id': string }> }) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });

  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/customers?error=tenant', request.url), 303);

  const routeParams = await params;
  const customerId = routeParams['customer-id'];
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.redirect(new URL(`/customers/${customerId}?error=archive-confirmation`, request.url), 303);
  }
  const confirmation = formData.get('confirmation');

  try {
    await archiveCustomer({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      customerId,
      confirmation: typeof confirmation === 'string' ? confirmation : '',
    });
    return NextResponse.redirect(new URL('/customers?status=archived', request.url), 303);
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof CustomerValidationError
        ? 'archive-confirmation'
        : error instanceof CustomerUnavailableError
          ? 'unavailable'
          : 'server';
    return NextResponse.redirect(new URL(`/customers/${customerId}?error=${code}`, request.url), 303);
  }
}
