import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { archiveHospitalityRestriction } from '@/server/inventory/hospitality-restriction-service.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'restriction-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.restriction.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL('/inventory?error=validation', request.url), 303), 'rejected');
  }

  const routeParams = await params;
  let propertyId = '';
  let ratePlanId = '';
  let roomTypeId = '';
  try {
    propertyId = formField(formData, 'propertyId');
    ratePlanId = formField(formData, 'ratePlanId');
    roomTypeId = formField(formData, 'roomTypeId');
    await archiveHospitalityRestriction({
      organizationId: organization.id,
      actorUserId: session.user.id,
      propertyId,
      ratePlanId,
      restrictionId: routeParams['restriction-id'],
      confirmation: formField(formData, 'confirmation'),
    });
    const query = new URLSearchParams({ ratePlan: ratePlanId, status: 'restriction-archived' });
    if (roomTypeId) query.set('roomType', roomTypeId);
    return finish(NextResponse.redirect(new URL(`/inventory/${propertyId}/restrictions?${query}`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    const response = !propertyId
      ? NextResponse.redirect(new URL(`/inventory?error=${code}`, request.url), 303)
      : (() => {
        const query = new URLSearchParams({ error: code });
        if (ratePlanId) query.set('ratePlan', ratePlanId);
        if (roomTypeId) query.set('roomType', roomTypeId);
        return NextResponse.redirect(new URL(`/inventory/${propertyId}/restrictions?${query}`, request.url), 303);
      })();
    return finish(response, code === 'server' ? 'failed' : 'rejected');
  }
}
