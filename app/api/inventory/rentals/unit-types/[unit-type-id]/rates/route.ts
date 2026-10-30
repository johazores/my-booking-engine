import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import { formField, inventoryErrorCode, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { createRentalRatePeriod } from '@/server/inventory/rental-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'unit-type-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rental-rate-period.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const unitTypeId = params['unit-type-id'];
  const path = `/inventory/rentals/types/${encodeURIComponent(unitTypeId)}`;
  const formData = await readInventoryFormData(request);
  if (!formData) return finish(redirectToLocalPath(`${path}?error=validation`), 'rejected');
  try {
    await createRentalRatePeriod({
      organizationId: organization.id,
      actorUserId: session.user.id,
      rate: { unitTypeId, startsOn: formField(formData, 'startsOn'), endsOn: formField(formData, 'endsOn'), dailyRateMinor: formField(formData, 'dailyRateMinor') },
    });
    return finish(redirectToLocalPath(`${path}?status=rate-created`));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(redirectToLocalPath(`${path}?error=${code}`), code === 'server' ? 'failed' : 'rejected');
  }
}
