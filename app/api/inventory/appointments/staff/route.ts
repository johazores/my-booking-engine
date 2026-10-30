import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createAppointmentStaff } from '@/server/inventory/appointment-service.ts';

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.appointment-staff.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath('/inventory/appointments?error=validation'), 'rejected');
  }
  try {
    const staff = await createAppointmentStaff({
      organizationId: organization.id,
      actorUserId: session.user.id,
      staff: {
        name: formField(formData, 'name'),
        code: formField(formData, 'code'),
        description: formField(formData, 'description'),
        timezone: formField(formData, 'timezone'),
      },
    });
    return finish(redirectToLocalPath(`/inventory/appointments/${staff.id}?status=staff-created`));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`/inventory/appointments?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
