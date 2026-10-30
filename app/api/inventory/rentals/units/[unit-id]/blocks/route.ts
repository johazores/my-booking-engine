import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import { formField, inventoryErrorCode, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { createRentalAvailabilityBlock } from '@/server/inventory/rental-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'unit-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rental-availability-block.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const unitId = params['unit-id'];
  const path = `/inventory/rentals/units/${encodeURIComponent(unitId)}`;
  const formData = await readInventoryFormData(request);
  if (!formData) return finish(redirectToLocalPath(`${path}?error=validation`), 'rejected');
  const startsOn = formField(formData, 'startsOn');
  const endsOn = formField(formData, 'endsOn');
  try {
    await createRentalAvailabilityBlock({
      organizationId: organization.id,
      actorUserId: session.user.id,
      block: { unitId, startsOn, endsOn, reason: formField(formData, 'reason') },
    });
    return finish(redirectToLocalPath(`${path}?status=block-created`));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(redirectToLocalPath(`${path}?error=${code}`), code === 'server' ? 'failed' : 'rejected');
  }
}
