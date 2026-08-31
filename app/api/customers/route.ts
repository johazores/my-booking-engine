import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  CustomerConflictError,
  createCustomer,
} from '@/server/customers/customer-service.ts';
import { CustomerValidationError } from '@/server/customers/customer-domain.ts';
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
  if (!activeContext.organization) return NextResponse.redirect(new URL('/customers?error=tenant', request.url), 303);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.redirect(new URL('/customers?error=validation', request.url), 303);
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
    return NextResponse.redirect(new URL(`/customers/${customer.id}?status=created`, request.url), 303);
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError
      ? 'permission'
      : error instanceof CustomerConflictError
        ? 'email'
        : error instanceof CustomerValidationError
          ? 'validation'
          : 'server';
    return NextResponse.redirect(new URL(`/customers?error=${code}`, request.url), 303);
  }
}
