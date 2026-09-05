import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import {
  createHospitalityImage,
  removeHospitalityImage,
  setPrimaryHospitalityImage,
} from '@/server/inventory/hospitality-image-service.ts';

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
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.image.mutate');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL('/inventory?error=validation', request.url), 303), 'rejected');
  }

  let propertyId = '';
  let roomTypeId = '';
  try {
    propertyId = formField(formData, 'propertyId');
    roomTypeId = formField(formData, 'roomTypeId');
    const action = formField(formData, 'action') || 'create';
    const scope = {
      organizationId: organization.id,
      actorUserId: session.user.id,
      propertyId,
      ...(roomTypeId ? { roomTypeId } : {}),
    };

    if (action === 'set-primary') {
      await setPrimaryHospitalityImage({ ...scope, imageId: formField(formData, 'imageId') });
      return finish(NextResponse.redirect(new URL(target(propertyId, roomTypeId, 'status=image-primary'), request.url), 303));
    }
    if (action === 'remove') {
      await removeHospitalityImage({ ...scope, imageId: formField(formData, 'imageId') });
      return finish(NextResponse.redirect(new URL(target(propertyId, roomTypeId, 'status=image-removed'), request.url), 303));
    }
    if (action !== 'create') return finish(new Response('Bad Request', { status: 400 }));

    await createHospitalityImage({
      ...scope,
      image: {
        url: formField(formData, 'url'),
        altText: formField(formData, 'altText'),
        sortOrder: formField(formData, 'sortOrder'),
        isPrimary: formField(formData, 'isPrimary'),
      },
    });
    return finish(NextResponse.redirect(new URL(target(propertyId, roomTypeId, 'status=image-created'), request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    const response = !propertyId
      ? NextResponse.redirect(new URL(`/inventory?error=${code}`, request.url), 303)
      : NextResponse.redirect(new URL(target(propertyId, roomTypeId, `error=${code}`), request.url), 303);
    return finish(response, code === 'server' ? 'failed' : 'rejected');
  }
}
