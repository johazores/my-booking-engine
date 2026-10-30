import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import {
  assignHospitalityAmenityToRoomType,
  removeHospitalityAmenityFromRoomType,
} from '@/server/inventory/hospitality-amenity-assignment-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.room-type-amenity.mutate');
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
    const amenityId = formField(formData, 'amenityId');
    const action = formField(formData, 'action');
    const payload = { organizationId: organization.id, actorUserId: session.user.id, propertyId, roomTypeId, amenityId };
    if (action === 'remove') await removeHospitalityAmenityFromRoomType(payload);
    else if (action === 'assign') await assignHospitalityAmenityToRoomType(payload);
    else return finish(new Response('Bad Request', { status: 400 }));

    return finish(redirectToLocalPath(`/inventory/${encodeURIComponent(propertyId)}?roomType=${encodeURIComponent(roomTypeId)}&status=${action === 'remove' ? 'room-type-amenity-removed' : 'room-type-amenity-assigned'}`));
  } catch (error) {
    const target = propertyId ? `/inventory/${encodeURIComponent(propertyId)}${roomTypeId ? `?roomType=${encodeURIComponent(roomTypeId)}&` : '?'}` : '/inventory?';
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${target}error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
