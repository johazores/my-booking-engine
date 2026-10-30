import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createTourAddon } from '@/server/inventory/tour-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'tour-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.tour-addon.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath('/inventory/tours?error=validation'), 'rejected');
  }

  const params = await context.params;
  const tourProductId = params['tour-id'];
  const tourProductPath = `/inventory/tours/${encodeURIComponent(tourProductId)}`;
  try {
    await createTourAddon({
      organizationId: organization.id,
      actorUserId: session.user.id,
      tourProductId,
      addon: {
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        description: formField(formData, 'description'),
        maxQuantityPerBooking: formField(formData, 'maxQuantityPerBooking'),
      },
    });
    return finish(redirectToLocalPath(`${tourProductPath}?status=addon-created`));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${tourProductPath}?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
