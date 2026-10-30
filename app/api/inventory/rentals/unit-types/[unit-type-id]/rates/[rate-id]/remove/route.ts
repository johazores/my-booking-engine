import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import { formField, inventoryErrorCode, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { removeRentalRatePeriod } from '@/server/inventory/rental-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'unit-type-id': string; 'rate-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rental-rate-period.remove');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const unitTypeId = params['unit-type-id'];
  const path = `/inventory/rentals/types/${encodeURIComponent(unitTypeId)}`;
  const formData = await readInventoryFormData(request);
  if (!formData) return finish(redirectToLocalPath(`${path}?error=validation`), 'rejected');
  try {
    await removeRentalRatePeriod({
      organizationId: organization.id,
      actorUserId: session.user.id,
      unitTypeId,
      rateId: params['rate-id'],
      confirmation: formField(formData, 'confirmation'),
    });
    return finish(redirectToLocalPath(`${path}?status=rate-removed`));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(redirectToLocalPath(`${path}?error=${code}`), code === 'server' ? 'failed' : 'rejected');
  }
}
