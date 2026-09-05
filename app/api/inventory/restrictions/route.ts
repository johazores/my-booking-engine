import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createHospitalityRestriction } from '@/server/inventory/hospitality-restriction-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.restriction.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL('/inventory?error=validation', request.url), 303), 'rejected');
  }

  let propertyId = '';
  let ratePlanId = '';
  let roomTypeId = '';
  try {
    propertyId = formField(formData, 'propertyId');
    ratePlanId = formField(formData, 'ratePlanId');
    roomTypeId = formField(formData, 'roomTypeId');
    await createHospitalityRestriction({
      organizationId: organization.id,
      actorUserId: session.user.id,
      restriction: {
        propertyId,
        ratePlanId,
        roomTypeId,
        startDate: formField(formData, 'startDate'),
        endDate: formField(formData, 'endDate'),
        minStayNights: formField(formData, 'minStayNights'),
        maxStayNights: formField(formData, 'maxStayNights'),
        closedToArrival: formField(formData, 'closedToArrival'),
        closedToDeparture: formField(formData, 'closedToDeparture'),
      },
    });
    const params = new URLSearchParams({ ratePlan: ratePlanId, status: 'restriction-created' });
    if (roomTypeId) params.set('roomType', roomTypeId);
    return finish(NextResponse.redirect(new URL(`/inventory/${propertyId}/restrictions?${params}`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    const response = !propertyId
      ? NextResponse.redirect(new URL(`/inventory?error=${code}`, request.url), 303)
      : (() => {
        const params = new URLSearchParams({ error: code });
        if (ratePlanId) params.set('ratePlan', ratePlanId);
        if (roomTypeId) params.set('roomType', roomTypeId);
        return NextResponse.redirect(new URL(`/inventory/${propertyId}/restrictions?${params}`, request.url), 303);
      })();
    return finish(response, code === 'server' ? 'failed' : 'rejected');
  }
}
