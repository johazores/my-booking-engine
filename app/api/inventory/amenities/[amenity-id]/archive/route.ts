import { NextResponse } from 'next/server';
import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { formField, inventoryErrorCode } from '@/server/inventory/inventory-http.ts';
import { archiveHospitalityAmenity } from '@/server/inventory/hospitality-amenity-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'amenity-id': string }> }) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });
  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/inventory?error=tenant', request.url), 303);
  try {
    const formData = await request.formData();
    const routeParams = await params;
    await archiveHospitalityAmenity({ organizationId: activeContext.organization.id, actorUserId: session.user.id, amenityId: routeParams['amenity-id'], confirmation: formField(formData, 'confirmation') });
    return NextResponse.redirect(new URL('/inventory/amenities?status=amenity-archived', request.url), 303);
  } catch (error) {
    return NextResponse.redirect(new URL(`/inventory/amenities?error=${inventoryErrorCode(error)}`, request.url), 303);
  }
}
