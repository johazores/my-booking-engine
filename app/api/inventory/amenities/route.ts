import { NextResponse } from 'next/server';
import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { formField, inventoryErrorCode } from '@/server/inventory/inventory-http.ts';
import { createHospitalityAmenity } from '@/server/inventory/hospitality-amenity-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });
  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/inventory?error=tenant', request.url), 303);
  try {
    const formData = await request.formData();
    await createHospitalityAmenity({ organizationId: activeContext.organization.id, actorUserId: session.user.id, amenity: { name: formField(formData, 'name'), code: formField(formData, 'code') } });
    return NextResponse.redirect(new URL('/inventory/amenities?status=amenity-created', request.url), 303);
  } catch (error) {
    return NextResponse.redirect(new URL(`/inventory/amenities?error=${inventoryErrorCode(error)}`, request.url), 303);
  }
}
