import { NextResponse } from 'next/server';

import { formField, inventoryErrorCode, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { archiveRentalUnit } from '@/server/inventory/rental-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'unit-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rental-unit.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const unitId = params['unit-id'];
  const path = `/inventory/rentals/units/${encodeURIComponent(unitId)}`;
  const formData = await readInventoryFormData(request);
  if (!formData) return finish(NextResponse.redirect(new URL(`${path}?error=validation`, request.url), 303), 'rejected');
  try {
    await archiveRentalUnit({ organizationId: organization.id, actorUserId: session.user.id, unitId, confirmation: formField(formData, 'confirmation') });
    return finish(NextResponse.redirect(new URL('/inventory/rentals?status=unit-archived', request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303), code === 'server' ? 'failed' : 'rejected');
  }
}
