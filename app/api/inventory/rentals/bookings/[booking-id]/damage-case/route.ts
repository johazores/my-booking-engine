import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import { openRentalDamageCase } from '@/server/bookings/rental-damage-case-service.ts';
import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(request, 'booking.rental.damage-case.open');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  const { 'booking-id': bookingId } = await params;
  const path = `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}`;

  if (!formData) {
    return finish(
      redirectToLocalPath(`${path}?error=validation`),
      'rejected',
    );
  }

  try {
    await openRentalDamageCase({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
      damageCase: { summary: formField(formData, 'summary') },
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
