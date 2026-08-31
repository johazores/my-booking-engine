import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { formField, inventoryErrorCode } from '@/server/inventory/inventory-http.ts';
import {
  assignHospitalityRatePlanToRoomType,
  removeHospitalityRatePlanFromRoomType,
} from '@/server/inventory/hospitality-rate-plan-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });
  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/inventory?error=tenant', request.url), 303);

  let propertyId = '';
  let ratePlanId = '';
  try {
    const formData = await request.formData();
    propertyId = formField(formData, 'propertyId');
    ratePlanId = formField(formData, 'ratePlanId');
    const payload = {
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      propertyId,
      roomTypeId: formField(formData, 'roomTypeId'),
      ratePlanId,
    };
    const action = formField(formData, 'action');
    if (action === 'remove') await removeHospitalityRatePlanFromRoomType(payload);
    else if (action === 'assign') await assignHospitalityRatePlanToRoomType(payload);
    else throw new Error('Unsupported rate plan assignment action.');
    return NextResponse.redirect(new URL(`/inventory/${propertyId}/rate-plans?ratePlan=${ratePlanId}&status=${action === 'remove' ? 'rate-plan-removed' : 'rate-plan-assigned'}`, request.url), 303);
  } catch (error) {
    const target = propertyId ? `/inventory/${propertyId}/rate-plans${ratePlanId ? `?ratePlan=${ratePlanId}` : ''}` : '/inventory';
    const separator = target.includes('?') ? '&' : '?';
    return NextResponse.redirect(new URL(`${target}${separator}error=${inventoryErrorCode(error)}`, request.url), 303);
  }
}
