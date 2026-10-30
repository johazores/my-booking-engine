import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createAppointmentService } from '@/server/inventory/appointment-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.appointment-service.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath('/inventory/appointments?error=validation'), 'rejected');
  }
  try {
    await createAppointmentService({
      organizationId: organization.id,
      actorUserId: session.user.id,
      service: {
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        description: formField(formData, 'description'),
        durationMinutes: formField(formData, 'durationMinutes'),
        bufferBeforeMinutes: formField(formData, 'bufferBeforeMinutes'),
        bufferAfterMinutes: formField(formData, 'bufferAfterMinutes'),
      },
    });
    return finish(redirectToLocalPath('/inventory/appointments?status=service-created'));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`/inventory/appointments?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
