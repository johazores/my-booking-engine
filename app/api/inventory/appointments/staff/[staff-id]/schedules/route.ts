import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createAppointmentSchedule } from '@/server/inventory/appointment-service.ts';

export async function POST(request: Request, context: { params: Promise<{ 'staff-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.appointment-schedule.create');
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
    await createAppointmentSchedule({
      organizationId: organization.id,
      actorUserId: session.user.id,
      staffId,
      schedule: {
        dayOfWeek: formField(formData, 'dayOfWeek'),
        startsAt: formField(formData, 'startsAt'),
        endsAt: formField(formData, 'endsAt'),
      },
    });
    return finish(NextResponse.redirect(new URL(`${staffPath}?status=schedule-created`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${staffPath}?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
