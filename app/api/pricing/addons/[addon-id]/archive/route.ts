import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { archiveHospitalityAddon } from '@/server/pricing/hospitality-addon-service.ts';
import { pricingErrorCode, pricingFormField } from '@/server/pricing/pricing-http.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'addon-id': string }> }) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });
  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/pricing?error=tenant', request.url), 303);
  const routeParams = await params;
  let propertyId = '';
  try {
    const formData = await request.formData();
    propertyId = pricingFormField(formData, 'propertyId');
    await archiveHospitalityAddon({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      propertyId,
      addonId: routeParams['addon-id'],
    });
    return NextResponse.redirect(new URL(`/pricing/${propertyId}/addons?status=addon-archived`, request.url), 303);
  } catch (error) {
    const target = propertyId ? `/pricing/${propertyId}/addons` : '/pricing';
    return NextResponse.redirect(new URL(`${target}?error=${pricingErrorCode(error)}`, request.url), 303);
  }
}
