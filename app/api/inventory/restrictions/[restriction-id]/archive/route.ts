import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

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
    return finish(redirectToLocalPath('/inventory?error=validation'), 'rejected');
  }

  let propertyId = '';
  let ratePlanId = '';
  let roomTypeId = '';
  let restrictionId = '';
  try {
    const routeParams = await params;
    restrictionId = routeParams['restriction-id'];
    propertyId = formField(formData, 'propertyId');
    ratePlanId = formField(formData, 'ratePlanId');
    roomTypeId = formField(formData, 'roomTypeId');
    await archiveHospitalityRestriction({
      organizationId: organization.id,
      actorUserId: session.user.id,
      propertyId,
      ratePlanId,
      restrictionId,
      confirmation: formField(formData, 'confirmation'),
    });
    const query = new URLSearchParams({ ratePlan: ratePlanId, status: 'restriction-archived' });
    if (roomTypeId) query.set('roomType', roomTypeId);
    return finish(redirectToLocalPath(`/inventory/${encodeURIComponent(propertyId)}/restrictions?${query}`));
  } catch (error) {
    const code = inventoryErrorCode(error);
    const response = !propertyId
      ? redirectToLocalPath(`/inventory?error=${code}`)
      : (() => {
        const query = new URLSearchParams({ error: code });
        if (ratePlanId) query.set('ratePlan', ratePlanId);
        if (roomTypeId) query.set('roomType', roomTypeId);
        return redirectToLocalPath(`/inventory/${encodeURIComponent(propertyId)}/restrictions?${query}`);
      })();
    return finish(response, code === 'server' ? 'failed' : 'rejected');
  }
}
