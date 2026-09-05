import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createHospitalityProperty } from '@/server/inventory/hospitality-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.property.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL('/inventory?error=validation', request.url), 303), 'rejected');
  }

  try {
    const property = await createHospitalityProperty({
      organizationId: organization.id,
      actorUserId: session.user.id,
      property: {
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        timezone: formField(formData, 'timezone'),
        addressLine1: formField(formData, 'addressLine1'),
        city: formField(formData, 'city'),
        region: formField(formData, 'region'),
        postalCode: formField(formData, 'postalCode'),
        countryCode: formField(formData, 'countryCode'),
      },
    });
    return finish(NextResponse.redirect(new URL(`/inventory/${property.id}?status=created`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`/inventory?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
