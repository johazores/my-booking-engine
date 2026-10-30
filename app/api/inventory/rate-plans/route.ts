import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createHospitalityRatePlan } from '@/server/inventory/hospitality-rate-plan-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rate-plan.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath('/inventory?error=validation'), 'rejected');
  }

  let propertyId = '';
  try {
    propertyId = formField(formData, 'propertyId');
    const ratePlan = await createHospitalityRatePlan({
      organizationId: organization.id,
      actorUserId: session.user.id,
      ratePlan: {
        propertyId,
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        description: formField(formData, 'description'),
      },
    });
    return finish(redirectToLocalPath(`/inventory/${ratePlan.propertyId}/rate-plans?ratePlan=${ratePlan.id}&status=rate-plan-created`));
  } catch (error) {
    const target = propertyId ? `/inventory/${encodeURIComponent(propertyId)}/rate-plans` : '/inventory';
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${target}?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
