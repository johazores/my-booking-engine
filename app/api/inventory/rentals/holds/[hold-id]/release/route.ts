import { NextResponse } from 'next/server';

import {
  inventoryErrorCode,
  prepareInventoryMutationRequest,
} from '@/server/inventory/inventory-http.ts';
import { releaseRentalAvailabilityHold } from '@/server/inventory/rental-hold-service.ts';
import { RentalInventoryConflictError } from '@/server/inventory/rental-service.ts';

export async function POST(
  request: Request,
  context: { params: Promise<{ 'hold-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(request, 'availability.rental-hold.release');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;

  try {
    const hold = await releaseRentalAvailabilityHold({
      organizationId: organization.id,
      actorUserId: session.user.id,
      holdId: params['hold-id'],
    });
    if (hold.status === 'CONSUMED') {
      throw new RentalInventoryConflictError(
        'This rental hold was already consumed into retained booking evidence and cannot be released.',
      );
    }
    if (hold.status !== 'RELEASED' && hold.status !== 'EXPIRED') {
      throw new RentalInventoryConflictError(
        'Rental hold release did not reach a terminal release state. Review the current hold before trying again.',
      );
    }
    const status = hold.status === 'EXPIRED' ? 'hold-expired' : 'hold-released';
    return finish(NextResponse.redirect(new URL(`/inventory/rentals/holds?status=${status}`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`/inventory/rentals/holds?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
