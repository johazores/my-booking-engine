import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createHospitalityRoom } from '@/server/inventory/hospitality-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.room.create');
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
    await createHospitalityRoom({
      organizationId: organization.id,
      actorUserId: session.user.id,
      room: {
        propertyId,
        roomTypeId,
        code: formField(formData, 'code'),
        floor: formField(formData, 'floor'),
      },
    });
    return finish(NextResponse.redirect(
      new URL(`/inventory/${propertyId}?roomType=${roomTypeId}&status=room-created`, request.url),
      303,
    ));
  } catch (error) {
    const target = propertyId ? `/inventory/${propertyId}${roomTypeId ? `?roomType=${roomTypeId}&` : '?'}` : '/inventory?';
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${target}error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
