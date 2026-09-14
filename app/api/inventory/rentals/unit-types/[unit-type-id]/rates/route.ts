import { NextResponse } from 'next/server';

import { formField, inventoryErrorCode, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { createRentalRatePeriod } from '@/server/inventory/rental-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'unit-type-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rental-rate-period.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const unitTypeId = params['unit-type-id'];
  const path = `/inventory/rentals/types/${encodeURIComponent(unitTypeId)}`;
  const formData = await readInventoryFormData(request);
  if (!formData) return finish(NextResponse.redirect(new URL(`${path}?error=validation`, request.url), 303), 'rejected');
  try {
    await createRentalRatePeriod({
      organizationId: organization.id,
      actorUserId: session.user.id,
      rate: { unitTypeId, startsOn: formField(formData, 'startsOn'), endsOn: formField(formData, 'endsOn'), dailyRateMinor: formField(formData, 'dailyRateMinor') },
    });
    return finish(NextResponse.redirect(new URL(`${path}?status=rate-created`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303), code === 'server' ? 'failed' : 'rejected');
  }
}
