import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createHospitalityAmenity } from '@/server/inventory/hospitality-amenity-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.amenity.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath('/inventory/amenities?error=validation'), 'rejected');
  }

  try {
    await createHospitalityAmenity({
      organizationId: organization.id,
      actorUserId: session.user.id,
      amenity: { name: formField(formData, 'name'), code: formField(formData, 'code') },
    });
    return finish(redirectToLocalPath('/inventory/amenities?status=amenity-created'));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`/inventory/amenities?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
