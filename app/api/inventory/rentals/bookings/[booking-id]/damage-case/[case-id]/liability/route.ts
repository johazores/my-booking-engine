import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import { decideRentalDamageLiability } from '@/server/bookings/rental-damage-liability-service.ts';
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
  const mutation = await prepareInventoryMutationRequest(request, 'booking.rental.damage-liability.decide');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  const { 'booking-id': bookingId, 'case-id': damageCaseId } = await params;
  const path = `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}`;

  if (!formData) {
    return finish(
      redirectToLocalPath(`${path}?error=validation`),
      'rejected',
    );
  }

  try {
    await decideRentalDamageLiability({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
      damageCaseId,
      decision: {
        outcome: formField(formData, 'outcome'),
        liableAmountMajor: formField(formData, 'liableAmountMajor'),
        reason: formField(formData, 'reason'),
      },
    });
    return finish(redirectToLocalPath(path));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${path}?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
