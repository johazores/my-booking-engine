import { NextResponse } from 'next/server';

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
      NextResponse.redirect(new URL(`${path}?error=validation`, request.url), 303),
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
      NextResponse.redirect(
        new URL(`${path}?status=operational-status-updated`, request.url),
        303,
      ),
    );
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
