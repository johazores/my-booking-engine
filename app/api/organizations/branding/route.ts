import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  BrandingConflictError,
  BrandingUnavailableError,
  updateOrganizationBranding,
} from '@/server/branding/branding-service.ts';
import { BrandingValidationError } from '@/server/branding/branding-domain.ts';
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
    return NextResponse.redirect(new URL('/branding?error=tenant', request.url), 303);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.redirect(new URL('/branding?error=validation', request.url), 303);
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
    return NextResponse.redirect(new URL('/branding?status=updated', request.url), 303);
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
    return NextResponse.redirect(new URL(`/branding?error=${code}`, request.url), 303);
  }
}
