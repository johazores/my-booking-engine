import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { formField, inventoryErrorCode } from '@/server/inventory/inventory-http.ts';
import { archiveHospitalityRatePlan } from '@/server/inventory/hospitality-rate-plan-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'rate-plan-id': string }> }) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });
  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/inventory?error=tenant', request.url), 303);

  const routeParams = await params;
  let propertyId = '';
  try {
    const formData = await request.formData();
    propertyId = formField(formData, 'propertyId');
    await archiveHospitalityRatePlan({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      propertyId,
      ratePlanId: routeParams['rate-plan-id'],
      confirmation: formField(formData, 'confirmation'),
    });
    return NextResponse.redirect(new URL(`/inventory/${propertyId}/rate-plans?status=rate-plan-archived`, request.url), 303);
  } catch (error) {
    const target = propertyId ? `/inventory/${propertyId}/rate-plans?ratePlan=${routeParams['rate-plan-id']}` : '/inventory';
    const separator = target.includes('?') ? '&' : '?';
    return NextResponse.redirect(new URL(`${target}${separator}error=${inventoryErrorCode(error)}`, request.url), 303);
  }
}
