import { NextResponse } from 'next/server';

import { formField, inventoryErrorCode, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { createRentalUnit } from '@/server/inventory/rental-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rental-unit.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  if (!formData) return finish(NextResponse.redirect(new URL('/inventory/rentals?error=validation', request.url), 303), 'rejected');
  const unitTypeId = formField(formData, 'unitTypeId');
  const path = `/inventory/rentals/types/${encodeURIComponent(unitTypeId)}`;
  try {
    const created = await createRentalUnit({
      organizationId: organization.id,
      actorUserId: session.user.id,
      unit: {
        unitTypeId,
        locationCode: formField(formData, 'locationCode'),
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        description: formField(formData, 'description'),
      },
    });
    return finish(NextResponse.redirect(new URL(`/inventory/rentals/units/${created.id}?status=unit-created`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303), code === 'server' ? 'failed' : 'rejected');
  }
}
