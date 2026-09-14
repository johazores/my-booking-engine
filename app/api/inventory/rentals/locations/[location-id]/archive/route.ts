import { NextResponse } from 'next/server';

import { formField, inventoryErrorCode, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { archiveRentalLocation } from '@/server/inventory/rental-service.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'location-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rental-location.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  const { 'location-id': locationId } = await params;
  const path = `/inventory/rentals/locations/${encodeURIComponent(locationId)}`;
  if (!formData) return finish(NextResponse.redirect(new URL(`${path}?error=validation`, request.url), 303), 'rejected');
  try {
    await archiveRentalLocation({
      organizationId: organization.id,
      actorUserId: session.user.id,
      locationId,
      confirmation: formField(formData, 'confirmation'),
    });
    return finish(NextResponse.redirect(new URL('/inventory/rentals?status=location-archived', request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303), code === 'server' ? 'failed' : 'rejected');
  }
}
