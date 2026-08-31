import { NextResponse } from 'next/server';
import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { formField, inventoryErrorCode } from '@/server/inventory/inventory-http.ts';
import { assignHospitalityAmenityToRoomType, removeHospitalityAmenityFromRoomType } from '@/server/inventory/hospitality-amenity-assignment-service.ts';
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
    const amenityId = formField(formData, 'amenityId');
    const action = formField(formData, 'action');
    if (action === 'remove') await removeHospitalityAmenityFromRoomType({ organizationId: activeContext.organization.id, actorUserId: session.user.id, propertyId, roomTypeId, amenityId });
    else await assignHospitalityAmenityToRoomType({ organizationId: activeContext.organization.id, actorUserId: session.user.id, propertyId, roomTypeId, amenityId });
    return NextResponse.redirect(new URL(`/inventory/${propertyId}?roomType=${roomTypeId}&status=${action === 'remove' ? 'room-type-amenity-removed' : 'room-type-amenity-assigned'}`, request.url), 303);
  } catch (error) {
    const target = propertyId ? `/inventory/${propertyId}${roomTypeId ? `?roomType=${roomTypeId}&` : '?'}` : '/inventory?';
    return NextResponse.redirect(new URL(`${target}error=${inventoryErrorCode(error)}`, request.url), 303);
  }
}
