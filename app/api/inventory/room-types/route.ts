import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createHospitalityRoomType } from '@/server/inventory/hospitality-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.room-type.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath('/inventory?error=validation'), 'rejected');
  }

  let propertyId = '';
  try {
    propertyId = formField(formData, 'propertyId');
    const roomType = await createHospitalityRoomType({
      organizationId: organization.id,
      actorUserId: session.user.id,
      roomType: {
        propertyId,
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        maxOccupancy: formField(formData, 'maxOccupancy'),
        bedsDescription: formField(formData, 'bedsDescription'),
      },
    });
    return finish(redirectToLocalPath(`/inventory/${roomType.propertyId}?roomType=${roomType.id}&status=room-type-created`));
  } catch (error) {
    const target = propertyId ? `/inventory/${encodeURIComponent(propertyId)}` : '/inventory';
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${target}?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
