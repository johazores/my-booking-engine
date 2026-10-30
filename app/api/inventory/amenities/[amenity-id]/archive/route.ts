import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { archiveHospitalityAmenity } from '@/server/inventory/hospitality-amenity-service.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'amenity-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.amenity.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath('/inventory/amenities?error=validation'), 'rejected');
  }

  try {
    const routeParams = await params;
    await archiveHospitalityAmenity({
      organizationId: organization.id,
      actorUserId: session.user.id,
      amenityId: routeParams['amenity-id'],
      confirmation: formField(formData, 'confirmation'),
    });
    return finish(redirectToLocalPath('/inventory/amenities?status=amenity-archived'));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`/inventory/amenities?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
