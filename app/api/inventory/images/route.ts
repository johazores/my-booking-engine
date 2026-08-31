import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { formField, inventoryErrorCode } from '@/server/inventory/inventory-http.ts';
import { createHospitalityImage, removeHospitalityImage, setPrimaryHospitalityImage } from '@/server/inventory/hospitality-image-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

function target(propertyId: string, roomTypeId: string, suffix: string) {
  const query = new URLSearchParams();
  if (roomTypeId) query.set('roomType', roomTypeId);
  if (suffix) {
    const [key, value] = suffix.split('=');
    if (key && value) query.set(key, value);
  }
  const encoded = query.toString();
  return `/inventory/${propertyId}/images${encoded ? `?${encoded}` : ''}`;
}

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
    const action = formField(formData, 'action') || 'create';
    const scope = {
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      propertyId,
      ...(roomTypeId ? { roomTypeId } : {}),
    };

    if (action === 'set-primary') {
      await setPrimaryHospitalityImage({ ...scope, imageId: formField(formData, 'imageId') });
      return NextResponse.redirect(new URL(target(propertyId, roomTypeId, 'status=image-primary'), request.url), 303);
    }
    if (action === 'remove') {
      await removeHospitalityImage({ ...scope, imageId: formField(formData, 'imageId') });
      return NextResponse.redirect(new URL(target(propertyId, roomTypeId, 'status=image-removed'), request.url), 303);
    }
    if (action !== 'create') return new Response('Bad Request', { status: 400 });

    await createHospitalityImage({
      ...scope,
      image: {
        url: formField(formData, 'url'),
        altText: formField(formData, 'altText'),
        sortOrder: formField(formData, 'sortOrder'),
        isPrimary: formField(formData, 'isPrimary'),
      },
    });
    return NextResponse.redirect(new URL(target(propertyId, roomTypeId, 'status=image-created'), request.url), 303);
  } catch (error) {
    if (!propertyId) return NextResponse.redirect(new URL(`/inventory?error=${inventoryErrorCode(error)}`, request.url), 303);
    return NextResponse.redirect(new URL(target(propertyId, roomTypeId, `error=${inventoryErrorCode(error)}`), request.url), 303);
  }
}
