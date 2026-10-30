import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

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
    return finish(redirectToLocalPath('/inventory?error=validation'), 'rejected');
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
    return finish(redirectToLocalPath(`/inventory/${encodeURIComponent(propertyId)}?roomType=${encodeURIComponent(roomTypeId)}&status=room-created`));
  } catch (error) {
    const target = propertyId ? `/inventory/${encodeURIComponent(propertyId)}${roomTypeId ? `?roomType=${encodeURIComponent(roomTypeId)}&` : '?'}` : '/inventory?';
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${target}error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
