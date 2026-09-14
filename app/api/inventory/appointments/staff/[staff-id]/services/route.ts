import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { assignAppointmentServiceToStaff } from '@/server/inventory/appointment-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'staff-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.appointment-staff-service.assign');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const staffId = params['staff-id'];
  const staffPath = `/inventory/appointments/${encodeURIComponent(staffId)}`;
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL(`${staffPath}?error=validation`, request.url), 303), 'rejected');
  }
  try {
    await assignAppointmentServiceToStaff({
      organizationId: organization.id,
      actorUserId: session.user.id,
      staffId,
      serviceCode: formField(formData, 'serviceCode'),
    });
    return finish(NextResponse.redirect(new URL(`${staffPath}?status=service-assigned`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${staffPath}?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
