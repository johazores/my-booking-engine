import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { createHospitalityBaseRate } from '@/server/pricing/hospitality-pricing-service.ts';
import { pricingErrorCode, pricingFormField } from '@/server/pricing/pricing-http.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });
  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/pricing?error=tenant', request.url), 303);

  let propertyId = '';
  let roomTypeId = '';
  let ratePlanId = '';
  try {
    const formData = await request.formData();
    propertyId = pricingFormField(formData, 'propertyId');
    roomTypeId = pricingFormField(formData, 'roomTypeId');
    ratePlanId = pricingFormField(formData, 'ratePlanId');
    await createHospitalityBaseRate({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      baseRate: {
        propertyId,
        roomTypeId,
        ratePlanId,
        startDate: pricingFormField(formData, 'startDate'),
        endDate: pricingFormField(formData, 'endDate'),
        amount: pricingFormField(formData, 'amount'),
      },
    });
    return NextResponse.redirect(new URL(`/pricing/${propertyId}?ratePlan=${ratePlanId}&roomType=${roomTypeId}&status=base-rate-created`, request.url), 303);
  } catch (error) {
    const target = propertyId ? `/pricing/${propertyId}` : '/pricing';
    const params = new URLSearchParams({ error: pricingErrorCode(error) });
    if (ratePlanId) params.set('ratePlan', ratePlanId);
    if (roomTypeId) params.set('roomType', roomTypeId);
    return NextResponse.redirect(new URL(`${target}?${params.toString()}`, request.url), 303);
  }
}
