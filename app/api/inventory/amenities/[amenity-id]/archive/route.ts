import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { archiveHospitalityAmenity } from '@/server/inventory/hospitality-amenity-service.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'amenity-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.amenity.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL('/inventory/amenities?error=validation', request.url), 303), 'rejected');
  }

  try {
    const routeParams = await params;
    await archiveHospitalityAmenity({
      organizationId: organization.id,
      actorUserId: session.user.id,
      amenityId: routeParams['amenity-id'],
      confirmation: formField(formData, 'confirmation'),
    });
    return finish(NextResponse.redirect(new URL('/inventory/amenities?status=amenity-archived', request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`/inventory/amenities?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
