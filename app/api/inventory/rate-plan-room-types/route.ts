import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

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
    return finish(redirectToLocalPath('/inventory?error=validation'), 'rejected');
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

    return finish(redirectToLocalPath(`/inventory/${encodeURIComponent(propertyId)}/rate-plans?ratePlan=${encodeURIComponent(ratePlanId)}&status=${action === 'remove' ? 'rate-plan-removed' : 'rate-plan-assigned'}`));
  } catch (error) {
    const target = propertyId
      ? `/inventory/${encodeURIComponent(propertyId)}/rate-plans${ratePlanId ? `?ratePlan=${encodeURIComponent(ratePlanId)}` : ''}`
      : '/inventory';
    const separator = target.includes('?') ? '&' : '?';
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${target}${separator}error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
