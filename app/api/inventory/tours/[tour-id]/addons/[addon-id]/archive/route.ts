import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { archiveTourAddon } from '@/server/inventory/tour-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'tour-id': string; 'addon-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.tour-addon.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const tourProductId = params['tour-id'];
  const tourProductPath = `/inventory/tours/${encodeURIComponent(tourProductId)}`;
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath(`${tourProductPath}?error=validation`), 'rejected');
  }
  try {
    await archiveTourAddon({
      organizationId: organization.id,
      actorUserId: session.user.id,
      tourProductId,
      addonId: params['addon-id'],
      confirmation: formField(formData, 'confirmation'),
    });
    return finish(redirectToLocalPath(`${tourProductPath}?status=addon-archived`));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${tourProductPath}?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
