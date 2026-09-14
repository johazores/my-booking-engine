import { NextResponse } from 'next/server';

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
    return finish(NextResponse.redirect(new URL('/inventory/appointments?error=validation', request.url), 303), 'rejected');
  }
  const params = await context.params;
  try {
    await archiveAppointmentService({
      organizationId: organization.id,
      actorUserId: session.user.id,
      serviceId: params['service-id'],
      confirmation: formField(formData, 'confirmation'),
    });
    return finish(NextResponse.redirect(new URL('/inventory/appointments?status=service-archived', request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`/inventory/appointments?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
