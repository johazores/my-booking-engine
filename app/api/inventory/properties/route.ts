import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createHospitalityProperty } from '@/server/inventory/hospitality-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.property.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath('/inventory?error=validation'), 'rejected');
  }

  try {
    const property = await createHospitalityProperty({
      organizationId: organization.id,
      actorUserId: session.user.id,
      property: {
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        timezone: formField(formData, 'timezone'),
        addressLine1: formField(formData, 'addressLine1'),
        city: formField(formData, 'city'),
        region: formField(formData, 'region'),
        postalCode: formField(formData, 'postalCode'),
        countryCode: formField(formData, 'countryCode'),
      },
    });
    return finish(redirectToLocalPath(`/inventory/${property.id}?status=created`));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`/inventory?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
