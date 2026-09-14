import { NextResponse } from 'next/server';

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
    return finish(NextResponse.redirect(new URL('/inventory/appointments?error=validation', request.url), 303), 'rejected');
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
    return finish(NextResponse.redirect(new URL(`/inventory/appointments/${staff.id}?status=staff-created`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`/inventory/appointments?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
