import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { archiveAppointmentService } from '@/server/inventory/appointment-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'service-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.appointment-service.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath('/inventory/appointments?error=validation'), 'rejected');
  }
  const params = await context.params;
  try {
    await archiveAppointmentService({
      organizationId: organization.id,
      actorUserId: session.user.id,
      serviceId: params['service-id'],
      confirmation: formField(formData, 'confirmation'),
    });
    return finish(redirectToLocalPath('/inventory/appointments?status=service-archived'));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`/inventory/appointments?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
