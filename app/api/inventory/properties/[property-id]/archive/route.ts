import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { archiveHospitalityProperty } from '@/server/inventory/hospitality-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'property-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.property.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath('/inventory?error=validation'), 'rejected');
  }

  try {
    const params = await context.params;
    await archiveHospitalityProperty({
      organizationId: organization.id,
      actorUserId: session.user.id,
      propertyId: params['property-id'],
      confirmation: formField(formData, 'confirmation'),
    });
    return finish(redirectToLocalPath('/inventory?status=property-archived'));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`/inventory?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
