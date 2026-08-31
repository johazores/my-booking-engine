import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { formField, inventoryErrorCode } from '@/server/inventory/inventory-http.ts';
import { archiveHospitalityRoomType } from '@/server/inventory/hospitality-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request, context: { params: Promise<{ 'room-type-id': string }> }) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });
  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/inventory?error=tenant', request.url), 303);
  let propertyId = '';
  try {
    const params = await context.params;
    const formData = await request.formData();
    propertyId = formField(formData, 'propertyId');
    await archiveHospitalityRoomType({ organizationId: activeContext.organization.id, actorUserId: session.user.id, roomTypeId: params['room-type-id'], confirmation: formField(formData, 'confirmation') });
    return NextResponse.redirect(new URL(propertyId ? `/inventory/${propertyId}?status=room-type-archived` : '/inventory?status=room-type-archived', request.url), 303);
  } catch (error) {
    const target = propertyId ? `/inventory/${propertyId}` : '/inventory';
    return NextResponse.redirect(new URL(`${target}?error=${inventoryErrorCode(error)}`, request.url), 303);
  }
}
