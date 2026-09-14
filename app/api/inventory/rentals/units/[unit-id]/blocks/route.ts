import { NextResponse } from 'next/server';

import { formField, inventoryErrorCode, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { createRentalAvailabilityBlock } from '@/server/inventory/rental-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'unit-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rental-availability-block.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const unitId = params['unit-id'];
  const path = `/inventory/rentals/units/${encodeURIComponent(unitId)}`;
  const formData = await readInventoryFormData(request);
  if (!formData) return finish(NextResponse.redirect(new URL(`${path}?error=validation`, request.url), 303), 'rejected');
  const startsOn = formField(formData, 'startsOn');
  const endsOn = formField(formData, 'endsOn');
  try {
    await createRentalAvailabilityBlock({
      organizationId: organization.id,
      actorUserId: session.user.id,
      block: { unitId, startsOn, endsOn, reason: formField(formData, 'reason') },
    });
    return finish(NextResponse.redirect(new URL(`${path}?status=block-created`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303), code === 'server' ? 'failed' : 'rejected');
  }
}
