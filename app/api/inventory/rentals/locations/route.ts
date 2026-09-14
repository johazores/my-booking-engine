import { NextResponse } from 'next/server';

import { formField, inventoryErrorCode, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { createRentalLocation } from '@/server/inventory/rental-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rental-location.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  if (!formData) return finish(NextResponse.redirect(new URL('/inventory/rentals?error=validation', request.url), 303), 'rejected');
  try {
    const created = await createRentalLocation({
      organizationId: organization.id,
      actorUserId: session.user.id,
      location: {
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        addressLine1: formField(formData, 'addressLine1'),
        addressLine2: formField(formData, 'addressLine2'),
        city: formField(formData, 'city'),
        region: formField(formData, 'region'),
        postalCode: formField(formData, 'postalCode'),
        countryCode: formField(formData, 'countryCode'),
        timeZone: formField(formData, 'timeZone'),
      },
    });
    return finish(NextResponse.redirect(new URL(`/inventory/rentals/locations/${created.id}?status=location-created`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(NextResponse.redirect(new URL(`/inventory/rentals?error=${code}`, request.url), 303), code === 'server' ? 'failed' : 'rejected');
  }
}
