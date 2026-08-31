import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { createHospitalityAddon } from '@/server/pricing/hospitality-addon-service.ts';
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
    await createHospitalityAddon({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      addon: {
        propertyId,
        roomTypeId,
        ratePlanId,
        name: pricingFormField(formData, 'name'),
        code: pricingFormField(formData, 'code'),
        description: pricingFormField(formData, 'description'),
        pricingModel: pricingFormField(formData, 'pricingModel'),
        amount: pricingFormField(formData, 'amount'),
        maxQuantity: pricingFormField(formData, 'maxQuantity'),
        startDate: pricingFormField(formData, 'startDate'),
        endDate: pricingFormField(formData, 'endDate'),
      },
    });
    return NextResponse.redirect(new URL(`/pricing/${propertyId}/addons?status=addon-created`, request.url), 303);
  } catch (error) {
    const target = propertyId ? `/pricing/${propertyId}/addons` : '/pricing';
    return NextResponse.redirect(new URL(`${target}?error=${pricingErrorCode(error)}`, request.url), 303);
  }
}
