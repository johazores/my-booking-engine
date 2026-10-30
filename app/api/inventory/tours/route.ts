import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createTourProduct } from '@/server/inventory/tour-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.tour-product.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath('/inventory/tours?error=validation'), 'rejected');
  }

  try {
    const product = await createTourProduct({
      organizationId: organization.id,
      actorUserId: session.user.id,
      product: {
        kind: formField(formData, 'kind'),
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        description: formField(formData, 'description'),
        timezone: formField(formData, 'timezone'),
        meetingPoint: formField(formData, 'meetingPoint'),
      },
    });
    return finish(redirectToLocalPath(`/inventory/tours/${product.id}?status=created`));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`/inventory/tours?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
