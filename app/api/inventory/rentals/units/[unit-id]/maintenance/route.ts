import { NextResponse } from 'next/server';

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
      NextResponse.redirect(new URL(`${path}?error=validation`, request.url), 303),
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
      NextResponse.redirect(new URL(`${path}?status=maintenance-opened`, request.url), 303),
    );
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
