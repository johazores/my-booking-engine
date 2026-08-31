import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { formField, inventoryErrorCode } from '@/server/inventory/inventory-http.ts';
import { archiveHospitalityRestriction } from '@/server/inventory/hospitality-restriction-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'restriction-id': string }> }) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });
  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/inventory?error=tenant', request.url), 303);

  const routeParams = await params;
  let propertyId = '';
  let ratePlanId = '';
  let roomTypeId = '';
  try {
    const formData = await request.formData();
    propertyId = formField(formData, 'propertyId');
    ratePlanId = formField(formData, 'ratePlanId');
    roomTypeId = formField(formData, 'roomTypeId');
    await archiveHospitalityRestriction({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      propertyId,
      ratePlanId,
      restrictionId: routeParams['restriction-id'],
      confirmation: formField(formData, 'confirmation'),
    });
    const query = new URLSearchParams({ ratePlan: ratePlanId, status: 'restriction-archived' });
    if (roomTypeId) query.set('roomType', roomTypeId);
    return NextResponse.redirect(new URL(`/inventory/${propertyId}/restrictions?${query}`, request.url), 303);
  } catch (error) {
    if (!propertyId) return NextResponse.redirect(new URL(`/inventory?error=${inventoryErrorCode(error)}`, request.url), 303);
    const query = new URLSearchParams({ error: inventoryErrorCode(error) });
    if (ratePlanId) query.set('ratePlan', ratePlanId);
    if (roomTypeId) query.set('roomType', roomTypeId);
    return NextResponse.redirect(new URL(`/inventory/${propertyId}/restrictions?${query}`, request.url), 303);
  }
}
