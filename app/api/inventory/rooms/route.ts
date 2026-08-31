import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { formField, inventoryErrorCode } from '@/server/inventory/inventory-http.ts';
import { createHospitalityRoom } from '@/server/inventory/hospitality-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });
  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/inventory?error=tenant', request.url), 303);
  let propertyId = '';
  let roomTypeId = '';
  try {
    const formData = await request.formData();
    propertyId = formField(formData, 'propertyId');
    roomTypeId = formField(formData, 'roomTypeId');
    await createHospitalityRoom({ organizationId: activeContext.organization.id, actorUserId: session.user.id, room: { propertyId, roomTypeId, code: formField(formData, 'code'), floor: formField(formData, 'floor') } });
    return NextResponse.redirect(new URL(`/inventory/${propertyId}?roomType=${roomTypeId}&status=room-created`, request.url), 303);
  } catch (error) {
    const target = propertyId ? `/inventory/${propertyId}${roomTypeId ? `?roomType=${roomTypeId}&` : '?'}` : '/inventory?';
    return NextResponse.redirect(new URL(`${target}error=${inventoryErrorCode(error)}`, request.url), 303);
  }
}
