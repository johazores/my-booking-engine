import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import {
  assignHospitalityAmenityToProperty,
  removeHospitalityAmenityFromProperty,
} from '@/server/inventory/hospitality-amenity-assignment-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.property-amenity.mutate');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath('/inventory?error=validation'), 'rejected');
  }

  let propertyId = '';
  try {
    propertyId = formField(formData, 'propertyId');
    const amenityId = formField(formData, 'amenityId');
    const action = formField(formData, 'action');
    const payload = { organizationId: organization.id, actorUserId: session.user.id, propertyId, amenityId };
    if (action === 'remove') await removeHospitalityAmenityFromProperty(payload);
    else if (action === 'assign') await assignHospitalityAmenityToProperty(payload);
    else return finish(new Response('Bad Request', { status: 400 }));

    return finish(redirectToLocalPath(`/inventory/${encodeURIComponent(propertyId)}?status=${action === 'remove' ? 'property-amenity-removed' : 'property-amenity-assigned'}`));
  } catch (error) {
    const target = propertyId ? `/inventory/${encodeURIComponent(propertyId)}` : '/inventory';
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${target}?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
