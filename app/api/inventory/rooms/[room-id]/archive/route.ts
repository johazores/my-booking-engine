import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { archiveHospitalityRoom } from '@/server/inventory/hospitality-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'room-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.room.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL('/inventory?error=validation', request.url), 303), 'rejected');
  }

  let propertyId = '';
  let roomTypeId = '';
  try {
    const params = await context.params;
    propertyId = formField(formData, 'propertyId');
    roomTypeId = formField(formData, 'roomTypeId');
    await archiveHospitalityRoom({
      organizationId: organization.id,
      actorUserId: session.user.id,
      roomId: params['room-id'],
      confirmation: formField(formData, 'confirmation'),
    });
    const target = propertyId
      ? `/inventory/${propertyId}${roomTypeId ? `?roomType=${roomTypeId}&status=room-archived` : '?status=room-archived'}`
      : '/inventory?status=room-archived';
    return finish(NextResponse.redirect(new URL(target, request.url), 303));
  } catch (error) {
    const target = propertyId ? `/inventory/${propertyId}${roomTypeId ? `?roomType=${roomTypeId}&` : '?'}` : '/inventory?';
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${target}error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
