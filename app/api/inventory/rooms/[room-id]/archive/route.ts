import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

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
    return finish(redirectToLocalPath('/inventory?error=validation'), 'rejected');
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
      ? `/inventory/${encodeURIComponent(propertyId)}${roomTypeId ? `?roomType=${encodeURIComponent(roomTypeId)}&status=room-archived` : '?status=room-archived'}`
      : '/inventory?status=room-archived';
    return finish(redirectToLocalPath(target));
  } catch (error) {
    const target = propertyId ? `/inventory/${encodeURIComponent(propertyId)}${roomTypeId ? `?roomType=${encodeURIComponent(roomTypeId)}&` : '?'}` : '/inventory?';
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${target}error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
