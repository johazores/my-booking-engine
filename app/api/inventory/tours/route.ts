import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createTourProduct } from '@/server/inventory/tour-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.tour-product.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL('/inventory/tours?error=validation', request.url), 303), 'rejected');
  }

  try {
    const product = await createTourProduct({
      organizationId: organization.id,
      actorUserId: session.user.id,
      product: {
        kind: formField(formData, 'kind'),
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        description: formField(formData, 'description'),
        timezone: formField(formData, 'timezone'),
        meetingPoint: formField(formData, 'meetingPoint'),
      },
    });
    return finish(NextResponse.redirect(new URL(`/inventory/tours/${product.id}?status=created`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`/inventory/tours?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
