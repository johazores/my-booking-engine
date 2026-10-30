import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import { formField, inventoryErrorCode, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { createRentalUnitType } from '@/server/inventory/rental-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rental-unit-type.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  if (!formData) return finish(redirectToLocalPath('/inventory/rentals?error=validation'), 'rejected');
  try {
    const created = await createRentalUnitType({
      organizationId: organization.id,
      actorUserId: session.user.id,
      unitType: {
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        description: formField(formData, 'description'),
        currency: formField(formData, 'currency'),
        defaultDailyRateMinor: formField(formData, 'defaultDailyRateMinor'),
      },
    });
    return finish(redirectToLocalPath(`/inventory/rentals/types/${created.id}?status=unit-type-created`));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(redirectToLocalPath(`/inventory/rentals?error=${code}`), code === 'server' ? 'failed' : 'rejected');
  }
}
