import { NextResponse } from 'next/server';

import {
  assessRentalDamageCase,
  closeRentalDamageCase,
  waiveRentalDamageCase,
} from '@/server/bookings/rental-damage-case-service.ts';
import { RentalInventoryValidationError } from '@/server/inventory/rental-domain.ts';
import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string; 'case-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(request, 'booking.rental.damage-case.transition');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  const { 'booking-id': bookingId, 'case-id': damageCaseId } = await params;
  const path = `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}`;

  if (!formData) {
    return finish(
      NextResponse.redirect(new URL(`${path}?error=validation`, request.url), 303),
      'rejected',
    );
  }

  try {
    const action = formField(formData, 'action').trim().toLowerCase();
    if (action === 'assess') {
      await assessRentalDamageCase({
        organizationId: organization.id,
        actorUserId: session.user.id,
        bookingId,
        damageCaseId,
        assessment: {
          estimatedRepairCostMajor: formField(formData, 'estimatedRepairCostMajor'),
          notes: formField(formData, 'notes'),
        },
      });
    } else if (action === 'waive') {
      await waiveRentalDamageCase({
        organizationId: organization.id,
        actorUserId: session.user.id,
        bookingId,
        damageCaseId,
        waiver: { reason: formField(formData, 'reason') },
      });
    } else if (action === 'close') {
      await closeRentalDamageCase({
        organizationId: organization.id,
        actorUserId: session.user.id,
        bookingId,
        damageCaseId,
        closure: { notes: formField(formData, 'notes') },
      });
    } else {
      throw new RentalInventoryValidationError('Rental damage case action is invalid.');
    }

    return finish(NextResponse.redirect(new URL(path, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
