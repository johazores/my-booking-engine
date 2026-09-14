import { NextResponse } from 'next/server';

import { formField, inventoryErrorCode, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { assertRentalUnitNotHeldForInventoryMutation } from '@/server/inventory/rental-hold-service.ts';
import { assignRentalUnitLocation } from '@/server/inventory/rental-service.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'unit-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rental-unit.location-assign');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  const { 'unit-id': unitId } = await params;
  const path = `/inventory/rentals/units/${encodeURIComponent(unitId)}`;
  if (!formData) return finish(NextResponse.redirect(new URL(`${path}?error=validation`, request.url), 303), 'rejected');
  try {
    await assertRentalUnitNotHeldForInventoryMutation({
      organizationId: organization.id,
      actorUserId: session.user.id,
      unitId,
    });
    await assignRentalUnitLocation({
      organizationId: organization.id,
      actorUserId: session.user.id,
      unitId,
      locationCode: formField(formData, 'locationCode'),
    });
    return finish(NextResponse.redirect(new URL(`${path}?status=location-assigned`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303), code === 'server' ? 'failed' : 'rejected');
  }
}
