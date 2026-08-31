import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { createHospitalityChargeRule } from '@/server/pricing/hospitality-charge-service.ts';
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
  try {
    const formData = await request.formData();
    propertyId = pricingFormField(formData, 'propertyId');
    const scope = pricingFormField(formData, 'scope');
    const [roomTypeId = '', ratePlanId = ''] = scope ? scope.split('|', 2) : ['', ''];
    await createHospitalityChargeRule({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      rule: {
        propertyId,
        roomTypeId,
        ratePlanId,
        name: pricingFormField(formData, 'name'),
        code: pricingFormField(formData, 'code'),
        kind: pricingFormField(formData, 'kind'),
        calculation: pricingFormField(formData, 'calculation'),
        value: pricingFormField(formData, 'value'),
        startDate: pricingFormField(formData, 'startDate'),
        endDate: pricingFormField(formData, 'endDate'),
      },
    });
    return NextResponse.redirect(new URL(`/pricing/${propertyId}/charges?status=charge-created`, request.url), 303);
  } catch (error) {
    const target = propertyId ? `/pricing/${propertyId}/charges` : '/pricing';
    return NextResponse.redirect(new URL(`${target}?error=${pricingErrorCode(error)}`, request.url), 303);
  }
}
