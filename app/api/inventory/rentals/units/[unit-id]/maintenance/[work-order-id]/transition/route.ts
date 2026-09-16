import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { transitionRentalMaintenanceWorkOrder } from '@/server/inventory/rental-maintenance-service.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'unit-id': string; 'work-order-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(
    request,
    'inventory.rental-maintenance.work-order-transition',
  );
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  const { 'unit-id': unitId, 'work-order-id': workOrderId } = await params;
  const path = `/inventory/rentals/units/${encodeURIComponent(unitId)}/maintenance`;
  if (!formData) {
    return finish(
      NextResponse.redirect(new URL(`${path}?error=validation`, request.url), 303),
      'rejected',
    );
  }

  try {
    await transitionRentalMaintenanceWorkOrder({
      organizationId: organization.id,
      actorUserId: session.user.id,
      unitId,
      workOrderId,
      transition: {
        status: formField(formData, 'status'),
        completionNotes: formField(formData, 'completionNotes'),
        cancellationReason: formField(formData, 'cancellationReason'),
      },
    });
    return finish(
      NextResponse.redirect(new URL(`${path}?status=maintenance-updated`, request.url), 303),
    );
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
