import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { archiveHospitalityRoomType } from '@/server/inventory/hospitality-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'room-type-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.room-type.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL('/inventory?error=validation', request.url), 303), 'rejected');
  }

  let propertyId = '';
  try {
    const params = await context.params;
    propertyId = formField(formData, 'propertyId');
    await archiveHospitalityRoomType({
      organizationId: organization.id,
      actorUserId: session.user.id,
      roomTypeId: params['room-type-id'],
      confirmation: formField(formData, 'confirmation'),
    });
    const target = propertyId
      ? `/inventory/${propertyId}?status=room-type-archived`
      : '/inventory?status=room-type-archived';
    return finish(NextResponse.redirect(new URL(target, request.url), 303));
  } catch (error) {
    const target = propertyId ? `/inventory/${propertyId}` : '/inventory';
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${target}?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
