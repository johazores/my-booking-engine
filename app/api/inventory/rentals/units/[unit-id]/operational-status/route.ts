import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { setRentalUnitOperationalStatus } from '@/server/inventory/rental-unit-operational-service.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'unit-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(
    request,
    'inventory.rental-unit.operational-status',
  );
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  const { 'unit-id': unitId } = await params;
  const path = `/inventory/rentals/units/${encodeURIComponent(unitId)}`;
  if (!formData) {
    return finish(
      redirectToLocalPath(`${path}?error=validation`),
      'rejected',
    );
  }

  try {
    await setRentalUnitOperationalStatus({
      organizationId: organization.id,
      actorUserId: session.user.id,
      unitId,
      operational: {
        status: formField(formData, 'status'),
        reason: formField(formData, 'reason'),
      },
    });
    return finish(
      redirectToLocalPath(`${path}?status=operational-status-updated`),
    );
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${path}?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
