import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createRentalMaintenanceWorkOrder } from '@/server/inventory/rental-maintenance-service.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'unit-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(
    request,
    'inventory.rental-maintenance.work-order-open',
  );
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  const { 'unit-id': unitId } = await params;
  const path = `/inventory/rentals/units/${encodeURIComponent(unitId)}/maintenance`;
  if (!formData) {
    return finish(
      redirectToLocalPath(`${path}?error=validation`),
      'rejected',
    );
  }

  try {
    await createRentalMaintenanceWorkOrder({
      organizationId: organization.id,
      actorUserId: session.user.id,
      unitId,
      workOrder: {
        idempotencyKey: formField(formData, 'idempotencyKey'),
        title: formField(formData, 'title'),
        description: formField(formData, 'description'),
      },
    });
    return finish(
      redirectToLocalPath(`${path}?status=maintenance-opened`),
    );
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${path}?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
