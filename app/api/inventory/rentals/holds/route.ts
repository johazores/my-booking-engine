import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { createRentalAvailabilityHold } from '@/server/inventory/rental-hold-service.ts';
import { readManagedRentalAvailabilityHoldState } from '@/server/inventory/rental-hold-state-service.ts';
import { RentalInventoryConflictError } from '@/server/inventory/rental-service.ts';

function availabilityReturnPath(formData: FormData) {
  const params = new URLSearchParams({
    unitTypeCode: formField(formData, 'unitTypeCode'),
    startsOn: formField(formData, 'startsOn'),
    endsOn: formField(formData, 'endsOn'),
    pageSize: formField(formData, 'pageSize') || '20',
  });
  const locationCode = formField(formData, 'locationCode');
  if (locationCode) params.set('locationCode', locationCode);
  return `/inventory/rentals/availability?${params.toString()}`;
}

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'availability.rental-hold.create');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(
      NextResponse.redirect(new URL('/inventory/rentals/availability?error=validation', request.url), 303),
      'rejected',
    );
  }

  const path = availabilityReturnPath(formData);
  try {
    const hold = await createRentalAvailabilityHold({
      organizationId: organization.id,
      actorUserId: session.user.id,
      hold: {
        unitId: formField(formData, 'unitId'),
        startsOn: formField(formData, 'startsOn'),
        endsOn: formField(formData, 'endsOn'),
        idempotencyKey: formField(formData, 'idempotencyKey'),
        expiresInMinutes: formField(formData, 'expiresInMinutes'),
      },
    });
    const state = await readManagedRentalAvailabilityHoldState({
      organizationId: organization.id,
      actorUserId: session.user.id,
      holdId: hold.id,
    });
    if (state.hold.status === 'CONSUMED') {
      throw new RentalInventoryConflictError(
        'This rental hold was already consumed into retained booking evidence. Review the booking instead of treating the hold as newly active.',
      );
    }
    const status = state.effective ? 'hold-active' : 'hold-inactive';
    return finish(NextResponse.redirect(new URL(`${path}&status=${status}`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${path}&error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
