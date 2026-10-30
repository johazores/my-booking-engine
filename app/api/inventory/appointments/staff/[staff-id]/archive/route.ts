import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { archiveAppointmentStaff } from '@/server/inventory/appointment-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'staff-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.appointment-staff.archive');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  const params = await context.params;
  const staffId = params['staff-id'];
  const staffPath = `/inventory/appointments/${encodeURIComponent(staffId)}`;
  if (!formData) {
    return finish(redirectToLocalPath(`${staffPath}?error=validation`), 'rejected');
  }
  try {
    await archiveAppointmentStaff({
      organizationId: organization.id,
      actorUserId: session.user.id,
      staffId,
      confirmation: formField(formData, 'confirmation'),
    });
    return finish(redirectToLocalPath('/inventory/appointments?status=staff-archived'));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${staffPath}?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
