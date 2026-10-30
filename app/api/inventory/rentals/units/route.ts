import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import { formField, inventoryErrorCode, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { createRentalUnit } from '@/server/inventory/rental-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rental-unit.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  if (!formData) return finish(redirectToLocalPath('/inventory/rentals?error=validation'), 'rejected');
  const unitTypeId = formField(formData, 'unitTypeId');
  const path = `/inventory/rentals/types/${encodeURIComponent(unitTypeId)}`;
  try {
    const created = await createRentalUnit({
      organizationId: organization.id,
      actorUserId: session.user.id,
      unit: {
        unitTypeId,
        locationCode: formField(formData, 'locationCode'),
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        description: formField(formData, 'description'),
      },
    });
    return finish(redirectToLocalPath(`/inventory/rentals/units/${created.id}?status=unit-created`));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(redirectToLocalPath(`${path}?error=${code}`), code === 'server' ? 'failed' : 'rejected');
  }
}
