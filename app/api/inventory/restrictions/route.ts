import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { formField, inventoryErrorCode } from '@/server/inventory/inventory-http.ts';
import { createHospitalityRestriction } from '@/server/inventory/hospitality-restriction-service.ts';
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
  let roomTypeId = '';
  try {
    const formData = await request.formData();
    propertyId = formField(formData, 'propertyId');
    ratePlanId = formField(formData, 'ratePlanId');
    roomTypeId = formField(formData, 'roomTypeId');
    await createHospitalityRestriction({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      restriction: {
        propertyId,
        ratePlanId,
        roomTypeId,
        startDate: formField(formData, 'startDate'),
        endDate: formField(formData, 'endDate'),
        minStayNights: formField(formData, 'minStayNights'),
        maxStayNights: formField(formData, 'maxStayNights'),
        closedToArrival: formField(formData, 'closedToArrival'),
        closedToDeparture: formField(formData, 'closedToDeparture'),
      },
    });
    const params = new URLSearchParams({ ratePlan: ratePlanId, status: 'restriction-created' });
    if (roomTypeId) params.set('roomType', roomTypeId);
    return NextResponse.redirect(new URL(`/inventory/${propertyId}/restrictions?${params}`, request.url), 303);
  } catch (error) {
    if (!propertyId) return NextResponse.redirect(new URL(`/inventory?error=${inventoryErrorCode(error)}`, request.url), 303);
    const params = new URLSearchParams({ error: inventoryErrorCode(error) });
    if (ratePlanId) params.set('ratePlan', ratePlanId);
    if (roomTypeId) params.set('roomType', roomTypeId);
    return NextResponse.redirect(new URL(`/inventory/${propertyId}/restrictions?${params}`, request.url), 303);
  }
}
