import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { archiveTourProduct } from '@/server/inventory/tour-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'tour-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.tour-product.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  const params = await context.params;
  const tourProductId = params['tour-id'];
  const tourProductPath = `/inventory/tours/${encodeURIComponent(tourProductId)}`;
  if (!formData) {
    return finish(redirectToLocalPath(`${tourProductPath}?error=validation`), 'rejected');
  }
  try {
    await archiveTourProduct({
      organizationId: organization.id,
      actorUserId: session.user.id,
      tourProductId,
      confirmation: formField(formData, 'confirmation'),
    });
    return finish(redirectToLocalPath('/inventory/tours?status=product-archived'));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${tourProductPath}?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
