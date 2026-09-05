import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createHospitalityRatePlan } from '@/server/inventory/hospitality-rate-plan-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.rate-plan.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL('/inventory?error=validation', request.url), 303), 'rejected');
  }

  let propertyId = '';
  try {
    propertyId = formField(formData, 'propertyId');
    const ratePlan = await createHospitalityRatePlan({
      organizationId: organization.id,
      actorUserId: session.user.id,
      ratePlan: {
        propertyId,
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        description: formField(formData, 'description'),
      },
    });
    return finish(NextResponse.redirect(
      new URL(`/inventory/${ratePlan.propertyId}/rate-plans?ratePlan=${ratePlan.id}&status=rate-plan-created`, request.url),
      303,
    ));
  } catch (error) {
    const target = propertyId ? `/inventory/${propertyId}/rate-plans` : '/inventory';
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${target}?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
