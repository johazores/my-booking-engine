import { NextResponse } from 'next/server';

import { formField, inventoryErrorCode, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { archiveRentalUnitType } from '@/server/inventory/rental-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'unit-type-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rental-unit-type.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const unitTypeId = params['unit-type-id'];
  const formData = await readInventoryFormData(request);
  const path = `/inventory/rentals/types/${encodeURIComponent(unitTypeId)}`;
  if (!formData) return finish(NextResponse.redirect(new URL(`${path}?error=validation`, request.url), 303), 'rejected');
  try {
    await archiveRentalUnitType({ organizationId: organization.id, actorUserId: session.user.id, unitTypeId, confirmation: formField(formData, 'confirmation') });
    return finish(NextResponse.redirect(new URL('/inventory/rentals?status=unit-type-archived', request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303), code === 'server' ? 'failed' : 'rejected');
  }
}
