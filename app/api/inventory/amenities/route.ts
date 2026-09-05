import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createHospitalityAmenity } from '@/server/inventory/hospitality-amenity-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.amenity.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL('/inventory/amenities?error=validation', request.url), 303), 'rejected');
  }

  try {
    await createHospitalityAmenity({
      organizationId: organization.id,
      actorUserId: session.user.id,
      amenity: { name: formField(formData, 'name'), code: formField(formData, 'code') },
    });
    return finish(NextResponse.redirect(new URL('/inventory/amenities?status=amenity-created', request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`/inventory/amenities?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
