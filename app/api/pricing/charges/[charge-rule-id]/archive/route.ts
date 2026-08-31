import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { archiveHospitalityChargeRule } from '@/server/pricing/hospitality-charge-service.ts';
import { pricingErrorCode, pricingFormField } from '@/server/pricing/pricing-http.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'charge-rule-id': string }> }) {
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
    await archiveHospitalityChargeRule({ organizationId: activeContext.organization.id, actorUserId: session.user.id, propertyId, chargeRuleId: routeParams['charge-rule-id'] });
    return NextResponse.redirect(new URL(`/pricing/${propertyId}/charges?status=charge-archived`, request.url), 303);
  } catch (error) {
    const target = propertyId ? `/pricing/${propertyId}/charges` : '/pricing';
    return NextResponse.redirect(new URL(`${target}?error=${pricingErrorCode(error)}`, request.url), 303);
  }
}
