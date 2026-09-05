import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { archiveHospitalityProperty } from '@/server/inventory/hospitality-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'property-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.property.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL('/inventory?error=validation', request.url), 303), 'rejected');
  }

  try {
    const params = await context.params;
    await archiveHospitalityProperty({
      organizationId: organization.id,
      actorUserId: session.user.id,
      propertyId: params['property-id'],
      confirmation: formField(formData, 'confirmation'),
    });
    return finish(NextResponse.redirect(new URL('/inventory?status=property-archived', request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`/inventory?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
