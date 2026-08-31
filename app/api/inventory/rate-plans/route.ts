import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { formField, inventoryErrorCode } from '@/server/inventory/inventory-http.ts';
import { createHospitalityRatePlan } from '@/server/inventory/hospitality-rate-plan-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });
  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/inventory?error=tenant', request.url), 303);

  let propertyId = '';
  try {
    const formData = await request.formData();
    propertyId = formField(formData, 'propertyId');
    const ratePlan = await createHospitalityRatePlan({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      ratePlan: {
        propertyId,
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        description: formField(formData, 'description'),
      },
    });
    return NextResponse.redirect(new URL(`/inventory/${ratePlan.propertyId}/rate-plans?ratePlan=${ratePlan.id}&status=rate-plan-created`, request.url), 303);
  } catch (error) {
    const target = propertyId ? `/inventory/${propertyId}/rate-plans` : '/inventory';
    return NextResponse.redirect(new URL(`${target}?error=${inventoryErrorCode(error)}`, request.url), 303);
  }
}
