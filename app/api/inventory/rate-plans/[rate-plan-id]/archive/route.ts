import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { archiveHospitalityRatePlan } from '@/server/inventory/hospitality-rate-plan-service.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'rate-plan-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rate-plan.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath('/inventory?error=validation'), 'rejected');
  }

  let propertyId = '';
  let ratePlanId = '';
  try {
    const routeParams = await params;
    ratePlanId = routeParams['rate-plan-id'];
    propertyId = formField(formData, 'propertyId');
    await archiveHospitalityRatePlan({
      organizationId: organization.id,
      actorUserId: session.user.id,
      propertyId,
      ratePlanId,
      confirmation: formField(formData, 'confirmation'),
    });
    return finish(redirectToLocalPath(`/inventory/${encodeURIComponent(propertyId)}/rate-plans?status=rate-plan-archived`));
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
