import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import {
  assignHospitalityRatePlanToRoomType,
  removeHospitalityRatePlanFromRoomType,
} from '@/server/inventory/hospitality-rate-plan-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rate-plan-room-type.mutate');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL('/inventory?error=validation', request.url), 303), 'rejected');
  }

  let propertyId = '';
  let ratePlanId = '';
  try {
    propertyId = formField(formData, 'propertyId');
    ratePlanId = formField(formData, 'ratePlanId');
    const payload = {
      organizationId: organization.id,
      actorUserId: session.user.id,
      propertyId,
      roomTypeId: formField(formData, 'roomTypeId'),
      ratePlanId,
    };
    const action = formField(formData, 'action');
    if (action === 'remove') await removeHospitalityRatePlanFromRoomType(payload);
    else if (action === 'assign') await assignHospitalityRatePlanToRoomType(payload);
    else return finish(new Response('Bad Request', { status: 400 }));

    return finish(NextResponse.redirect(
      new URL(`/inventory/${propertyId}/rate-plans?ratePlan=${ratePlanId}&status=${action === 'remove' ? 'rate-plan-removed' : 'rate-plan-assigned'}`, request.url),
      303,
    ));
  } catch (error) {
    const target = propertyId
      ? `/inventory/${propertyId}/rate-plans${ratePlanId ? `?ratePlan=${ratePlanId}` : ''}`
      : '/inventory';
    const separator = target.includes('?') ? '&' : '?';
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${target}${separator}error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
