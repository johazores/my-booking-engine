import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import { formField, inventoryErrorCode, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { archiveRentalLocation } from '@/server/inventory/rental-service.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'location-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rental-location.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  const { 'location-id': locationId } = await params;
  const path = `/inventory/rentals/locations/${encodeURIComponent(locationId)}`;
  if (!formData) return finish(redirectToLocalPath(`${path}?error=validation`), 'rejected');
  try {
    await archiveRentalLocation({
      organizationId: organization.id,
      actorUserId: session.user.id,
      locationId,
      confirmation: formField(formData, 'confirmation'),
    });
    return finish(redirectToLocalPath('/inventory/rentals?status=location-archived'));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(redirectToLocalPath(`${path}?error=${code}`), code === 'server' ? 'failed' : 'rejected');
  }
}
