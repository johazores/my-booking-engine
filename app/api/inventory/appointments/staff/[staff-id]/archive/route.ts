import { NextResponse } from 'next/server';

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
    return finish(NextResponse.redirect(new URL(`${staffPath}?error=validation`, request.url), 303), 'rejected');
  }
  try {
    await archiveAppointmentStaff({
      organizationId: organization.id,
      actorUserId: session.user.id,
      staffId,
      confirmation: formField(formData, 'confirmation'),
    });
    return finish(NextResponse.redirect(new URL('/inventory/appointments?status=staff-archived', request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${staffPath}?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
